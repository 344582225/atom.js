
var Event = function(e) {

	e || (e = {});

	this.event = undefined;
	this.altKey = false;
	this.bubbles = false;
	this.button = 0;
	this.cancelBubble = false;
	this.cancelable = false;
	this.charCode = 0;
	this.clientX = 0;
	this.clientY = 0;
	this.ctrlKey = false;
	this.dataTransfer = null;
	this.defaultPrevented = false;
	this.detail = 0;
	this.deltaMode = 0;
	this.deltaX = 0;
	this.deltaY = 0;
	this.deltaZ = 0;
	this.wheelDelta = 0;
	this.wheelDeltaX = 0;
	this.wheelDeltaY = 0;
	this.eventPhase = 0;
	this.keyCode = 0;
	this.layerX = 0;
	this.layerY = 0;
	this.metaKey = false;
	this.movementX = 0;
	this.movementY = 0;
	this.offsetX = 0;
	this.offsetY = 0;
	this.pageX = 0;
	this.pageY = 0;
	this.screenX = 0;
	this.screenY = 0;
	this.shiftKey = false;
	this.type = undefined;
	this.which = 0;
	this.x = 0;
	this.y = 0;

	for (var i in this) {
		if (typeof e[i] !== 'undefined') {
			this[i] = e[i];
		}
	}

}

Event.prototype.NONE = 0;
Event.prototype.CAPTURING_PHASE = 1;
Event.prototype.AT_TARGET = 2;
Event.prototype.BUBBLING_PHASE = 3;
Event.prototype.MOUSEDOWN = 1;
Event.prototype.MOUSEUP = 2;
Event.prototype.MOUSEOVER = 4;
Event.prototype.MOUSEOUT = 8;
Event.prototype.MOUSEMOVE = 16;
Event.prototype.MOUSEDRAG = 32;
Event.prototype.CLICK = 64;
Event.prototype.DBLCLICK = 128;
Event.prototype.KEYDOWN = 256;
Event.prototype.KEYUP = 512;
Event.prototype.KEYPRESS = 1024;
Event.prototype.DRAGDROP = 2048;
Event.prototype.FOCUS = 4096;
Event.prototype.BLUR = 8192;
Event.prototype.SELECT = 16384;
Event.prototype.CHANGE = 32768;

module.exports = Event;
