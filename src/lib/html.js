
'use strict';

/**
 * Module dependencies.
 */

var builder = require('./builder');

/**
 * Module constructor.
 */

var HTML = function(body, opts) {
	opts || (opts = {});
	var v = new builder().compile;
	return v('html', [
		v('head', [
			v('meta', { charset: 'utf-8' }),
			v('title', typeof opts.title == 'string' && !!opts.title.trim() ? opts.title : '')
		]),
		v('body', [
			body,
			v('script', {
				type: 'text/javascript',
				charset: 'utf-8',
				src: '/atom.js'
			})
		])
	]);
}

module.exports = HTML;