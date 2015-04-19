
var Socket = require('engine.io-client');

var Sync = function (options) {
	options || (options = {});
	options.path = (options.path || '/atom').replace(/\/$/, '') + '/';
	Socket.call(this, options);
}

Sync.prototype = Object.create(Socket.prototype);

module.exports = Sync;