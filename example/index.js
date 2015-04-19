/**
 * Module dependencies.
 */

var express = require('express'),
	app = express(),

	server = require('http').createServer(app),

	atom = require('../src/atom'),
	engine = atom();

engine.attach(server);

app.use(engine.route('/', {
	'/': require('./mvc/home'),
	'/contact': require('./mvc/contact')
}));

server.listen(4000);


