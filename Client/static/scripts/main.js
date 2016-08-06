function Blob (x,y,col) {
	this.x = x;
	this.y = y;
	this.color = col;
	this.ang = Math.random()*Math.PI;
	this.isVirus = false;
}

/*************************************************************************************************************************/

window.onload = function() {
	var canvas = document.getElementById("canvas"),
		context = canvas.getContext("2d");
	width = canvas.width = window.innerWidth;
	height = canvas.height = window.innerHeight;
	var ready = false;

	var mp = new Player(-1);		// main player
	//var wheel = 0;
	var frame = 1;
	var infoPan = new InfoPan();
	var spanel = document.getElementById("start-panel"),
			spanel_style = window.getComputedStyle(spanel),
	    spanelWstr = spanel_style.getPropertyValue("width"),
	    spanelHstr = spanel_style.getPropertyValue("height"),
	    spanelW = parseInt(spanelWstr.substr(0, spanelWstr.length-2)),
	    spanelH = parseInt(spanelHstr.substr(0, spanelHstr.length-2)),
			spanel_col = 20;
	spanel.style.top = ""+(height-spanelH)/2 +"px";
	spanel.style.left = ""+(width-spanelW)/2 + "px";

    if ("WebSocket" in window) console.log("WebSockets Supported.");
    else console.log("Browser doesn't support WebSockets");

	generateBlobs();
	Connect();
	initFPS();

	run();

	window.onresize = function(event) {
		// update stuff that depend on the window size
	    width = canvas.width = window.innerWidth;
			height = canvas.height = window.innerHeight;
	    infoPan.refresh();
	};


function Connect(){
	conn = new WebSocket('ws://'+ip_address+':'+port);
	conn.onopen = function(e) {
		console.log("Connected to server");
		addEventListeners();
	};

	var fst_msg = true;
	conn.onmessage = function(e) {

		// if this is the first msg:
		if(fst_msg) {
			var init_data = String(e.data).split(',');
			mp.pid = parseInt(init_data[0]);
			mp.organs.push(new Organ(1,1,parseFloat(init_data[3]),1,1));
			mp.organs[0].x = parseFloat(init_data[1]);
			mp.organs[0].y = parseFloat(init_data[2]);
			mp.organs[0].size = parseFloat(init_data[3]);
			mp.organs[0].xspd = parseFloat(init_data[4]);
			mp.organs[0].yspd = parseFloat(init_data[5]);
			mp.cmx = mp.organs[0].x;
			mp.cmy = mp.organs[0].y;

			authStateCopy  = new Player(-1);
    		copyPlayer(mp, authStateCopy);

			fst_msg = false;
			spanel.style.display = "none";
			infoPan.show();

			t = 0;
			accumulator = 0.0;
			absoluteTime = 0.0;
			//lastTime = performance.now();
			ready = true;

			return;
		}
		
        // authState has the same properties as mp. A state is almost a Player() object more or less
        // We'll fill the authState with the data we recieved
        // TODO: implement this functionality with a better de/serialization mechanism
		authState = null;
		authState = new Object();
		authState.organs = [];

		var AllOrgs = String(e.data).split(';');		// organs/players are separated by ';'

		for (var i=0; i < AllOrgs.length; i++) { 		// for each organ in the server's message:
			// player/organs' properties are separated by ','
			var orgData = AllOrgs[i].split(',');

			// add the ith organ to authState
			var curOrg = new Organ( parseFloat(orgData[1]),
				parseFloat(orgData[2]),
				parseFloat(orgData[3]),
				parseFloat(orgData[4]),
				parseFloat(orgData[5])
			);
			curOrg.lock =  parseInt(orgData[6]) ? true : false;
			curOrg.applyPosEase = parseInt(orgData[7]) ? true : false;
			curOrg.applySizeEase = parseInt(orgData[8]) ? true : false;
			curOrg.massDelta = parseFloat(orgData[9]);
			curOrg.easeDist = parseFloat(orgData[10]);
			curOrg.easex = parseFloat(orgData[11]);
			curOrg.easey = parseFloat(orgData[12]);
			authState.organs.push(curOrg);

			// those properties are for the player, not for the organs, but for now the server appends them to each organ belonging to the player.
			// they should really be added, sent and read just once though (instead of in a loop) to avoid redundancy
			authState.pid = parseInt(orgData[0]);
			authState.directX = parseFloat(orgData[13]);
			authState.directY = parseFloat(orgData[14]);
			authState.cmx = parseFloat(orgData[15]);
			authState.cmy = parseFloat(orgData[16]);
			authState.seq = parseInt(orgData[17]);

		}

	};	// end onmessage() ;

	conn.onclose = function(e) {
		ready = false;
	    setTimeout(Connect, 5000);
	};

	function addEventListeners(){

		document.body.addEventListener("mousemove", function(event) {
			inBuff.push({
				seq : inSeq,
				xdir : event.clientX-(width/2.0),
				ydir : event.clientY-(height/2.0),
				inType : "mm"
			});
			inSeq++;
		});

		document.body.addEventListener("mousedown", function(event) {
			inBuff.push({
				seq : inSeq,
				xdir : event.clientX-(width/2.0),
				ydir : event.clientY-(height/2.0),
				inType : "md"
			});
			inSeq++;
		});

		window.onkeyup = function(e) {
		    var key = e.keyCode ? e.keyCode : e.which;
		    if (key == 73) 
		        showServer = !showServer;
		    else if (key == 80) 
	       		showPts = !showPts;
		    else if (key == 79) 
		        showName = !showName; 
		};
	}
}	// end connect()

function send(input) {
	if(input)
		conn.send(input.inType+","+input.xdir+","+input.ydir+","+input.seq);
}

function processServerMsg() {	
	if(authState == null) return;
	// Overwrite mp's state by the authState we got from the server.
	// The state includes all mp's properties and his organs' properties as well
	 
	mp = null;
	mp = new Player(authState.pid);
	copyPlayer(authState, mp, false);

	// Re-apply all inputs/physics not processed by server yet
	if(reconciliation) {
		var i = 0;
        while (i < pendingInputs.length) {
            var input = pendingInputs[i];

            if (input.seq <= authState.seq) {
              // Already processed. Its effect is already taken into account into the world update we got from server, so we can drop it.
              pendingInputs.splice(i, 1);
            } else {
              // Not processed by the server yet. Re-apply it.
              applyInput(input);
              i++;
            }
        }

        if(predictedState != null)		// reconciliation for physics/state
        	copyPlayer(predictedState, mp, true);
	}

	else {		// if we're not reconciling, drop all stored inputs cuz we dont need them
		pendingInput = [];
	}

	// save the server's state for later rendering of server output
    authStateBackup = new Player(-1);  copyPlayer(authState, authStateBackup, false);	

    predictedState = null;
	authState = null;
}

function run() {		// Main game-loop function
	if(ready) {

		processServerMsg();		// Set mp's state according to server's authoritative msg. Also do reconciliation if enabled.

		var batchSize = batch_size; // multiple mouse inputs could be coming in a frame, so we have to process multiple per frame.
		while(batchSize-- > 0 && inBuff.length > 0) {
			var input = inBuff.shift();			// shift() removes the first element... thus inBuffs functions as a queue
			send(input);
			pendingInputs.push(input);			// store inputs sent to server for later reconciliation
			if(prediction) applyInput(input);	// client-prediction for input
		}

		if(prediction) {	// client-prediction for physics/state

			// Fixed timestep: courtesy of Glenn Fiedler of gafferongames.com
			var newTime = performance.now()*1.0;
			calcFPS(newTime);
			var deltaTime = newTime - absoluteTime;
			if(deltaTime > 200) deltaTime = timestep;
			if(deltaTime > 0.0)	{
				absoluteTime = newTime;
				accumulator += deltaTime;
				while(accumulator >= timestep) {		
					mp.update();
					accumulator -= timestep;
					t++;					
				}
			}

			// save the state after prediction for later reconiliation 
			predictedState = new Player(mp.pid);
			copyPlayer(mp, predictedState, true);
		}

		//console.log(Date()+"   "+frame);
		//console.log("\t"+mp.cmx+"\t"+mp.cmy);

		/*** Rendering ***/
		context.clearRect(0, 0, width, height);
		xshift = mp.cmx - width/2;
		yshift = mp.cmy - height/2;
		drawGrid();
		drawBlobs();

		for(var i=0; i<mp.organs.length; i++)
			mp.organs[i].draw(context, "Player");
		if(showServer)
		for(var i=0; i<authStateBackup.organs.length; i++) // draw the server's
			authStateBackup.organs[i].draw(context, "Server",true);
		

		// draw info on the panel
		var data = {
			cmx1: authStateCopy.cmx,
			cmx2: mp.cmx,
			cmy1: authStateCopy.cmy,
			cmy2: mp.cmy,
			frm: frame++
		};
		infoPan.updateData(data);

		context.textAlign = 'left';
	    context.font = '25px sans-serif';
	    context.fillStyle = 'gray';
		context.fillText(fps, 25, 30);

	}

	else {	// if not ready
		context.fillStyle = '#333333';
        context.fillRect(0, 0, width, height);

        context.textAlign = 'center';
        context.fillStyle = '#FFFFFF';
        context.font = 'bold 30px sans-serif';
		context.fillText('Connecting to server....', width/2, height/2);
		spanel.style.display = "block";
	}

	requestAnimationFrame(run);
}	// end run()

function applyInput(input) {
	mp.directX = input.xdir;
	mp.directY = input.ydir;
	
	var tempOrgans = [];
	for(var i=0; i < mp.organs.length; i++) {
		// each orgnas will try to move towards the mouse pointer, but later when the organs are packed together, they'll follow CM direction
		var xspd = mp.organs[i].xspd;
		var yspd = mp.organs[i].yspd;
		var mag = Math.sqrt(xspd*xspd + yspd*yspd);
		var ang = Math.atan2( input.ydir - mp.organs[i].y + mp.cmy,			// the direction angle from the organ to the mouse location
							  input.xdir - mp.organs[i].x + mp.cmx  );

		mp.organs[i].xspd = Math.cos(ang) * mag;
		mp.organs[i].yspd = Math.sin(ang) * mag;

		if(input.inType == 'md')
			tempOrgans.push(mp.organs[i].split());
	}

	for(var i=0; i < tempOrgans.length; i++)
		mp.organs.push(tempOrgans[i]);

}	// end process()

function drawGrid() {
	/*var maxX = wrdWidth/2, maxY = wrdHeight/2;
	var ulx = 2 -xshift -maxX,			// upleft
		uly = 2 -yshift- maxY,
		urx = wrdWidth -xshift-maxX,	// upright
		ury = 2 -yshift-maxY,
		dlx = 2 -xshift-maxX,			// downleft
		dly = wrdHeight -yshift-maxY,
		drx = wrdWidth -xshift-maxX,	// downright
		dry = wrdHeight -yshift-maxY;
	context.beginPath();
	context.moveTo(ulx,uly);
	context.lineTo(dlx,dly);
	context.stroke();
	context.beginPath();
	context.moveTo(ulx,uly);
	context.lineTo(urx,ury);
	context.stroke();
	context.beginPath();
	context.moveTo(urx,ury);
	context.lineTo(drx,dry);
	context.stroke();
	context.beginPath();
	context.moveTo(drx,dry);
	context.lineTo(dlx,dly);
	context.stroke();
*/

	var scl = 50;	// the distance between grid lines

	var nHor = Math.floor(width/scl);	// how many vertical lines can we fit in the window
	var nVer = Math.floor(height/scl);	// how many horizontal lines can we fit.

	var offX = width % scl;		// any left over space horizontally
	var offY = height % scl;	// any left over space vertically

	context.beginPath();
	context.strokeStyle = '#99bbff';
	context.lineWidth = 1;

	// draw vertical lines:
	for(var i = 0; i <= nHor; i++){
		// X % m
		// to extend the domain of X to include negative integers,
		// i came up with this mod function:   ( m + (X%m) ) % m
		// not sure if there's a better way.
		// In our case, X is width + scl - offX,  and  q is (i*scl - xshift)

		// when lines go off the visible area, wrap around
		var m = width + (scl - offX);		// when will the line wrap around?  when it goes off the visible area by scl - offX
		var X = (m + ((i*scl - xshift)% m)) % m;

		context.moveTo(X, 0);
		context.lineTo(X, height);
	}

	// same procedure for drawing horizontal lines:
	for(var i = 0; i <= nVer; i++) {
		var m = height + scl - offY;
		var Y = (m + ((i*scl - yshift)% m)) % m;

		context.moveTo(0,     Y);
		context.lineTo(width, Y);
	}

	context.stroke();
	context.closePath();

}	// end drawGrid();

function generateBlobs() {
	var world_area = wrdWidth*wrdHeight;
	var available_area = world_area;// - size;
	/* blob_count * blobSize / available_area = density  */
	var blob_count = (blobDensity * available_area) / blobSize;
	//console.log(blob_count);
	blobs = [];
	for (var i = 0; i < blob_count; i++) {
		blobs.push( new Blob(-(wrdWidth/2) + wrdWidth*Math.random(), -(wrdHeight/2) + wrdHeight*Math.random(), colors[Math.floor((Math.random() * colors.length))]) );
		blobs[i].isVirus = Math.floor(Math.random()*1000)%25 == 1.0;	// make some blobs viruses
	}
}

function drawBlobs() {
	for (var i = 0; i < blobs.length; i++) {
		if(!blobs[i].isVirus)
		drawCircle(blobs[i].x - xshift, blobs[i].y - yshift,
				blobSize, 6, blobs[i].color, blobs[i].ang);
		else
		drawCircle(blobs[i].x - xshift, blobs[i].y - yshift,
				blobSize*6, 17, "Chartreuse", 0);
	}
}

// draw a polygon with given sides and radius(for the circumscribing circle)
function drawCircle(x,y,rad,sides,col,start) {
	var ang = 2*Math.PI/sides;
	var cur = start;

	context.beginPath();
	context.moveTo(x+ rad*Math.cos(cur), y+rad*Math.sin(cur));
	for(var i=0; i<sides; i++) {
		context.lineTo(x+ rad*Math.cos(cur+ang), y+rad*Math.sin(cur+ang));
		cur += ang;
	}
	context.closePath();
	context.fillStyle = col;
	context.fill();
}

function initFPS() {
	for(var i=0; i < 10; i++) fps_arr.push(0.0);
}

function calcFPS(now){
	function calAVG() {
		   var count=0.0;
		   for (var i=fps_arr.length; i--;)
		     count+=fps_arr[i];

		   return Math.round(count/fps_arr.length);
	}

	fps_arr[_ind_%10] = 1000.0/(now-absoluteTime);
	_ind_++;

	fps = calAVG();
}

}	// end window.onload()

/*************************************************************************************************************************/

/* Helper Functions */

function distSq(x1,y1,x2,y2){
	return (x2-x1)*(x2-x1) + (y2-y1)*(y2-y1);
}

/*

function sizeToSpd(sz) {
		return sz/10;
}

function compUV(ux,uy,vx,vy){		// component of u along v
	var udotv = ux*vx + uy*vy;
	var vdotv = vx*vx + vy*vy;
	var scaler = udotv/vdotv;
	return {
		xcomp : vx*scaler,
		ycomp : vy*scaler
	};
}


	function showPanel() {
		if(ready) panel.style.display = "none";
		//panel.style.background = "rgba("+panel_col+","+panel_col+","+panel_col+", 0.85)";
		else panel.style.display = "block";
	}

	window.onkeyup = function(e) {
	   var key = e.keyCode ? e.keyCode : e.which;
	   if (key == 83) {
	       ;
	   }
	}
	document.body.addEventListener("wheel", function(WheelEvent) {
		wheel += -WheelEvent.deltaY/100;
		console.log(wheel)
		panel_col = 5*Math.floor(wheel);
		panel.style.background = "rgba("+panel_col+","+panel_col+","+panel_col+", 0.85)";
	});
*/