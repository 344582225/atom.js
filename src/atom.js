/**
 * Module dependencies.
 */

'use strict';

var EngineIO = require('engine.io'),
	EngineServer = EngineIO.Server,

	Stream = require('./lib/stream'),
	Builder = require('./lib/builder'),
	Render = require('./lib/render'),
	HTML = require('./lib/html'),

	Storage = { };

/**
 * Atom constructor.
 *
 * @param {Object} options
 * @api public
 */

var Atom = function(options) {
	if (!(this instanceof Atom)) {
		return new Atom(options);
	}
	var atom = this,
		opts = atom.opts = {};
	if (typeof options == 'object') {
		for (var i in options) {
			opts[i] = options[i];
		}
	}
	EngineServer.prototype.on('connection', function(socket) {
		atom.onConnection.call(atom, socket);
		socket.on('error', function(err) {
			atom.onError.call(atom, socket, err);
		});
		socket.on('message', function(data) {
			atom.onMessage.call(atom, socket, data);
		});
		socket.on('close', function() {
			atom.onDisconnection.call(atom, socket);
		});
	});
	return EngineServer.call(this, opts);
}

/**
 * Atom extends Engine.IO-Server.
 */

Atom.prototype = Object.create(EngineServer.prototype);

/**
 * Captures requests for a http.Server.
 *
 * @param {http.Server} server
 * @param {Object} options
 * @api public
 */

Atom.prototype.attach = function(server, options) {
	var opts = this.opts || (this.opts = {});
	for (var i in options) {
		opts[i] = options[i];
	}
	opts.path = (opts.path || '/atom').replace(/\/$/, '') + '/';
	EngineServer.prototype.attach.call(this, server, opts);
}

/**
 * Router for a http.Server.
 *
 * @param {String} defaultRoute
 * @param {Object} routes
 * @api public
 */

Atom.prototype.route = function(defaultRoute, routes) {

	var atom = this,
		route = this.opts.route || (this.opts.route = {}),

		syncjs = undefined,

		pack = require('browserify')({ standalone: 'Atom' });

	pack.add(__dirname + '/client/index.js');

	pack.bundle(function(err, buf) {
		syncjs = buf.toString('utf8');
	});

	if (typeof defaultRoute == 'string') {
		this.opts.defaultRoute = defaultRoute;
	}
	if (typeof routes == 'object') {
		for (var i in routes) {
			route[i] = routes[i];
		}
	}
	return function(req, res, next) {
		if (req.url === '/atom.js') {
			if (typeof res.setHeader == 'function') {
				res.setHeader('Content-Type', 'text/javascript');
			}
			res.end(syncjs);
		} else {
			for (var i in route) {
				var path = i,
					module = route[i],
					matcher = new RegExp('^' + path.replace(/:[^\/]+?\.{3}/g, '(.*?)').replace(/:[^\/]+/g, '([^\\/]+)') + '\/?$');
				if (matcher.test(req.url)) {
					res.end( atom.render.call(atom, module.controller, module.view, module.options || {}) );
				}
			}
		}
		if (typeof next == 'function') {
			next.call(undefined);
		}
	}
}

/**
 * Connection Handler for a EngineIO.Server.
 *
 * @param {EngineIO.Socket} socket
 * @api private
 */

Atom.prototype.onConnection = function(socket) {
	var stream = new Stream;
	stream.id = socket.id;
	stream.browser.host = socket.request.headers.host;
	stream.browser.userAgent = socket.request.headers['user-agent'];
	stream.browser.cookie = socket.request.headers.cookie;
	if (socket.request && socket.request.headers && socket.request.headers.referer) {
		stream.browser.route = socket.request.headers.referer
								.replace('http://', '')
								.replace('https://', '')
								.replace(socket.request.headers.host, '');
	}
	Storage[socket.id] = stream;
}

/**
 * Disconnection Handler for a EngineIO.Server.
 *
 * @param {EngineIO.Socket} socket
 * @api private
 */

Atom.prototype.onDisconnection = function(socket) {
	delete Storage[socket.id];
}

/**
 * Message Handler for a EngineIO.Server.
 *
 * @param {EngineIO.Socket} socket
 * @param {Object} data
 * @api private
 */

Atom.prototype.onMessage = function(socket, data) {
	var stream = Storage[socket.id];
	if (typeof stream == 'undefined') {
		stream = new Stream;
		stream.id = socket.id;
		stream.browser.host = socket.request.headers.host;
		stream.browser.userAgent = socket.request.headers['user-agent'];
		stream.browser.cookie = socket.request.headers.cookie;
		Storage[socket.id] = stream;
	}
	if (socket.request && socket.request.headers && socket.request.headers.referer) {
		stream.browser.route = socket.request.headers.referer
								.replace('http://', '')
								.replace('https://', '')
								.replace(socket.request.headers.host, '');
	}
	var msg;
	try {
		msg = JSON.parse(data);
	} catch (err) {
		msg = {};
		msg.event = data;
	}
	switch(msg.event) {
		case 'sync':
			this.sync.call(this, socket, stream, msg);
			break;
		case 'event':
			this.events.call(this, socket, stream, msg);
			break;
		default:
			break;
	}
}

/**
 * Error Handler for a EngineIO.Server.
 *
 * @param {EngineIO.Socket} socket
 * @param {Error} err
 * @api private
 */

Atom.prototype.onError = function(socket, err) {
	console.log('onError', err);
}

/**
 * HTML Render for Atom.
 *
 * @param {Function} controller
 * @param {Function} view
 * @param {Object} options
 * @api public
 */

Atom.prototype.render = function(controller, view, opts) {
	return Atom.Render([
		Atom.HTML( this.compile(controller, view) , opts )
	]);
}

/**
 * Virtual DOM compiler for Atom.
 *
 * @param {Function, Object} controller
 * @param {Function} view
 * @param {Object} options
 * @api public
 */

Atom.prototype.compile = function(controller, view, eventScope) {
	return view(typeof controller == 'function' ? new controller : controller, new Atom.Builder(eventScope).compile);
}

/**
 * Route matcher for Atom.
 *
 * @param {Stream} stream
 * @param {Object} msg
 * @param {Function} callback
 * @api private
 */

Atom.prototype.match = function(stream, msg, callback) {
	var route = this.opts.route || (this.opts.route = {});
	if (typeof msg.route == 'string') {
		stream.browser.route = msg.route;
	}
	for (var i in route) {
		var path = i,
			module = route[i],
			matcher = new RegExp('^' + path.replace(/:[^\/]+?\.{3}/g, '(.*?)').replace(/:[^\/]+/g, '([^\\/]+)') + '\/?$');
		if (matcher.test(stream.browser.route) && typeof callback == 'function') {
			callback.call(this, path, module);
		}
	}
}

/**
 * Template Sync for Atom.
 *
 * @param {EngineIO.Socket} socket
 * @param {Stream} stream
 * @param {Object} msg
 * @api private
 */

Atom.prototype.sync = function(socket, stream, msg) {
	this.match(stream, msg, function(path, module) {
		if (typeof stream.controllers[ path ] == 'undefined') {
			stream.controllers[ path ] = new module.controller();
		}
		if (typeof stream.events[ path ] == 'undefined') {
			stream.events[ path ] = { };
		}
		var controller = stream.controllers[ path ],
			events = stream.events[ path ];
		var obj = {
			event: 'sync',
			nodes: this.compile.call(this, controller, module.view, events)
		};
		socket.send(JSON.stringify(obj));
	});
}

/**
 * Event handler for Atom.
 *
 * @param {EngineIO.Socket} socket
 * @param {Stream} stream
 * @param {Object} msg
 * @api private
 */

Atom.prototype.events = function(socket, stream, msg) {
	this.match(stream, msg, function(path, module) {
		if (typeof stream.controllers[ path ] == 'undefined') {
			stream.controllers[ path ] = new module.controller();
		}
		if (typeof stream.events[ path ] == 'undefined') {
			stream.events[ path ] = { };
		}
		var controller = stream.controllers[ path ],
			handler = stream.events[ path ][ msg.id ];
		if (typeof handler == 'function') {
			handler.apply(controller, msg.args || []);
		}
	});
}

/**
 * Exports Atom dependencies.
 */

Atom.Stream = Stream;
Atom.Builder = Builder;
Atom.Render = Render;
Atom.HTML = HTML;

/**
 * Module exports.
 */

module.exports = Atom;
