/**
 * Module dependencies.
 */

var hash = require('object-hash');

	OBJECT = '[object Object]', 
	ARRAY = '[object Array]', 
	STRING = '[object String]', 
	FUNCTION = 'function',

	type = {}.toString,

	parser = /(?:(^|#|\.)([^#\.\[\]]+))|(\[.+?\])/g, 
	attrParser = /\[(.+?)(?:=('|'|)(.*?)\2)?\]/,

	voidElements = /^(AREA|BASE|BR|COL|COMMAND|EMBED|HR|IMG|INPUT|KEYGEN|LINK|META|PARAM|SOURCE|TRACK|WBR)$/;

/**
 * Builder constructor.
 *
 * @param {Object} options
 * @api public
 */

var Builder = function(scope) { 
	scope || (scope = { });
	return {
		compile: function() {
			var args = [].slice.call(arguments);
			var hasAttrs = args[1] != null && type.call(args[1]) === OBJECT && !('tag' in args[1]) && !('subtree' in args[1]);
			var attrs = hasAttrs ? args[1] : {};
			var classAttrName = 'class' in attrs ? 'class' : 'className';
			var cell = { tag: 'div', attrs: {} };
			var match, classes = [];
			if (type.call(args[0]) != STRING) throw new Error('selector in m(selector, attrs, children) should be a string')
			while (match = parser.exec(args[0])) {
				if (match[1] === '' && match[2]) cell.tag = match[2];
				else if (match[1] === '#') cell.attrs.id = match[2];
				else if (match[1] === '.') classes.push(match[2]);
				else if (match[3][0] === '[') {
					var pair = attrParser.exec(match[3]);
					cell.attrs[pair[1]] = pair[3] || (pair[2] ? '' :true)
				}
			}
			if (classes.length > 0) {
				cell.attrs[classAttrName] = classes.join(' ');
			};

			var children = hasAttrs ? args.slice(2) : args.slice(1);

			if (children.length === 1 && type.call(children[0]) === ARRAY) {
				cell.children = children[0]
			} else {
				cell.children = children
			}

			for (var attrName in attrs) {
				if (attrName === classAttrName) {
					var className = cell.attrs[attrName]
					cell.attrs[attrName] = (className && attrs[attrName] ? className + ' ' : className || '') + attrs[attrName];
				} else {
					if (typeof attrs[attrName] == 'function') {
						var hashid = hash.sha1({ tag: cell.tag, class: cell.attrs[classAttrName], callback: attrs[attrName] });
						cell.attrs['atom:' + attrName] = hashid;
						scope[hashid] = attrs[attrName];
					} else {
						cell.attrs[attrName] = attrs[attrName]
					}
				}
			}
			return cell
		}
	}
};

/**
 * Module exports.
 */

module.exports = Builder;