
'use strict';

var OBJECT = '[object Object]', 
	ARRAY = '[object Array]', 
	STRING = '[object String]', 
	FUNCTION = 'function',

	type = {}.toString,

	parser = /(?:(^|#|\.)([^#\.\[\]]+))|(\[.+?\])/g, 
	attrParser = /\[(.+?)(?:=('|'|)(.*?)\2)?\]/,

	voidElements = /^(AREA|BASE|BR|COL|COMMAND|EMBED|HR|IMG|INPUT|KEYGEN|LINK|META|PARAM|SOURCE|TRACK|WBR)$/;

var isEvent = function(o) {
	//grab the constructor for the unknown object
	var c = o.constructor;
	//convert constructor to string
	var s = c.toString(); 
	/* declare IE RegExp pattern to match for 'object [Event]' */
	if (document.all) {
		//set regExp pattern for IE
		var ptr=/\[object Event\]/;     
	} else {
		/* declare FIREFOX regExp pattern to match for 'object [*Event]' since it has
		   several event types:
		UIEvent 
		KeyboardEvent
		MouseEvent
		FocusEvent
		WheelEvent
		CompositionEvent
		StorageEvent
		CustomEvent (Requires Gecko 6.0)
		MutationEvent

		Both Custom and Mutation events are not recognized prior to Gecko 6.0,
		so if you want to use these, adjust regExp accordingly */
		var ptr=/\[object (Keyboard|Mouse|Focus|Wheel|Composition|Storage)Event\]/; 
	}   
	return ptr.test(s);  
}

var Sync = require('./sync');
var AtomEvent = require('./event');

var core = new Sync({
	transports: [ 'polling', 'websocket' ]
});

core.on('open', function() {
	core.on('message', function(data) {
		var msg = JSON.parse(data);
		switch(msg.event) {
			case 'sync':
				module.exports.render(document.body, msg.nodes);
				break;
		}
	});
	core.on('close', function() {

	});
});

module.exports.Event = AtomEvent;

window.addEventListener('load', function() {
	module.exports.sync();
});

window.addEventListener('popstate', function(event) {
	module.exports.sync();
});

module.exports.sync = function() {
	var msg = { event: 'sync', route: location.pathname };
	core.send(JSON.stringify(msg));
};

module.exports.event = function(type, id, event) {
	var msg = { event: 'event', route: location.pathname, type: type, id: id, args: [ event ] };
	core.send(JSON.stringify(msg));
}

module.exports.route = function(arg) {
	if (isEvent(arg) && typeof arg.href == 'string') {
		history.pushState(null, null, arg.href);
	} else {
		history.pushState(null, null, arg);
	}
	module.exports.sync();
}

var html;
var documentNode = {
	appendChild: function(node) {
		if (html === undefined) html = document.createElement("html");
		if (document.documentElement && document.documentElement !== node) {
			document.replaceChild(node, document.documentElement)
		}
		else document.appendChild(node);
		this.childNodes = document.childNodes
	},
	insertBefore: function(node) {
		this.appendChild(node)
	},
	childNodes: []
};
var nodeCache = [], cellCache = {};
module.exports.render = function(root, cell, forceRecreation) {
	var configs = [];
	if (!root) throw new Error('Please ensure the DOM element exists before rendering a template into it.');
	var id = getCellCacheKey(root);
	var isDocumentRoot = root === document;
	var node = isDocumentRoot || root === document.documentElement ? documentNode : root;
	if (isDocumentRoot && cell.tag != "html") cell = {tag: "html", attrs: {}, children: cell};
	if (cellCache[id] === undefined) clear(node.childNodes);
	if (forceRecreation === true) reset(root);
	cellCache[id] = build(node, null, undefined, undefined, cell, cellCache[id], false, 0, null, undefined, configs);
	for (var i = 0, len = configs.length; i < len; i++) configs[i]()
};

function getCellCacheKey(element) {
	var index = nodeCache.indexOf(element);
	return index < 0 ? nodeCache.push(element) - 1 : index
}

module.exports.raw = function(value) {
	value = new String(value);
	value.$trusted = true;
	return value
};

function gettersetter(store) {
	var prop = function() {
		if (arguments.length) store = arguments[0];
		return store
	};

	prop.toJSON = function() {
		return store
	};

	return prop
}

module.exports.prop = function (store) {
	//note: using non-strict equality check here because we're checking if store is null OR undefined
	if (((store != null && type.call(store) === OBJECT) || typeof store === FUNCTION) && typeof store.then === FUNCTION) {
		return propify(store)
	}

	return gettersetter(store)
};

var roots = [], modules = [], controllers = [], lastRedrawId = null, lastRedrawCallTime = 0, computePostRedrawHook = null, prevented = false, topModule;
var FRAME_BUDGET = 16;

var build = function (parentElement, parentTag, parentCache, parentIndex, data, cached, shouldReattach, index, editable, namespace, configs) {
	//`build` is a recursive function that manages creation/diffing/removal of DOM elements based on comparison between `data` and `cached`
	//the diff algorithm can be summarized as this:
	//1 - compare `data` and `cached`
	//2 - if they are different, copy `data` to `cached` and update the DOM based on what the difference is
	//3 - recursively apply this algorithm for every array and for the children of every virtual element

	//the `cached` data structure is essentially the same as the previous redraw's `data` data structure, with a few additions:
	//- `cached` always has a property called `nodes`, which is a list of DOM elements that correspond to the data represented by the respective virtual element
	//- in order to support attaching `nodes` as a property of `cached`, `cached` is *always* a non-primitive object, i.e. if the data was a string, then cached is a String instance. If data was `null` or `undefined`, cached is `new String("")`
	//- `cached also has a `configContext` property, which is the state storage object exposed by config(element, isInitialized, context)
	//- when `cached` is an Object, it represents a virtual element; when it's an Array, it represents a list of elements; when it's a String, Number or Boolean, it represents a text node

	//`parentElement` is a DOM element used for W3C DOM API calls
	//`parentTag` is only used for handling a corner case for textarea values
	//`parentCache` is used to remove nodes in some multi-node cases
	//`parentIndex` and `index` are used to figure out the offset of nodes. They're artifacts from before arrays started being flattened and are likely refactorable
	//`data` and `cached` are, respectively, the new and old nodes being diffed
	//`shouldReattach` is a flag indicating whether a parent node was recreated (if so, and if this node is reused, then this node must reattach itself to the new parent)
	//`editable` is a flag that indicates whether an ancestor is contenteditable
	//`namespace` indicates the closest HTML namespace as it cascades down from an ancestor
	//`configs` is a list of config functions to run after the topmost `build` call finishes running

	//there's logic that relies on the assumption that null and undefined data are equivalent to empty strings
	//- this prevents lifecycle surprises from procedural helpers that mix implicit and explicit return statements (e.g. function foo() {if (cond) return m("div")}
	//- it simplifies diffing code
	//data.toString() is null if data is the return value of Console.log in Firefox
	try {if (data == null || data.toString() == null) data = "";} catch (e) {data = ""}
	if (data.subtree === "retain") return cached;
	var cachedType = type.call(cached), dataType = type.call(data);
	if (cached == null || cachedType !== dataType) {
		if (cached != null) {
			if (parentCache && parentCache.nodes) {
				var offset = index - parentIndex;
				var end = offset + (dataType === ARRAY ? data : cached.nodes).length;
				clear(parentCache.nodes.slice(offset, end), parentCache.slice(offset, end))
			}
			else if (cached.nodes) clear(cached.nodes, cached)
		}
		cached = new data.constructor;
		if (cached.tag) cached = {}; //if constructor creates a virtual dom element, use a blank object as the base cached node instead of copying the virtual el (#277)
		cached.nodes = []
	}

	if (dataType === ARRAY) {
		//recursively flatten array
		for (var i = 0, len = data.length; i < len; i++) {
			if (type.call(data[i]) === ARRAY) {
				data = data.concat.apply([], data);
				i-- //check current index again and flatten until there are no more nested arrays at that index
				len = data.length
			}
		}
		
		var nodes = [], intact = cached.length === data.length, subArrayCount = 0;

		//keys algorithm: sort elements without recreating them if keys are present
		//1) create a map of all existing keys, and mark all for deletion
		//2) add new keys to map and mark them for addition
		//3) if key exists in new list, change action from deletion to a move
		//4) for each key, handle its corresponding action as marked in previous steps
		var DELETION = 1, INSERTION = 2 , MOVE = 3;
		var existing = {}, unkeyed = [], shouldMaintainIdentities = false;
		for (var i = 0; i < cached.length; i++) {
			if (cached[i] && cached[i].attrs && cached[i].attrs.key != null) {
				shouldMaintainIdentities = true;
				existing[cached[i].attrs.key] = {action: DELETION, index: i}
			}
		}
		
		var guid = 0
		for (var i = 0, len = data.length; i < len; i++) {
			if (data[i] && data[i].attrs && data[i].attrs.key != null) {
				for (var j = 0, len = data.length; j < len; j++) {
					if (data[j] && data[j].attrs && data[j].attrs.key == null) data[j].attrs.key = "__mithril__" + guid++
				}
				break
			}
		}
		
		if (shouldMaintainIdentities) {
			var keysDiffer = false
			if (data.length != cached.length) keysDiffer = true
			else for (var i = 0, cachedCell, dataCell; cachedCell = cached[i], dataCell = data[i]; i++) {
				if (cachedCell.attrs && dataCell.attrs && cachedCell.attrs.key != dataCell.attrs.key) {
					keysDiffer = true
					break
				}
			}
			
			if (keysDiffer) {
				for (var i = 0, len = data.length; i < len; i++) {
					if (data[i] && data[i].attrs) {
						if (data[i].attrs.key != null) {
							var key = data[i].attrs.key;
							if (!existing[key]) existing[key] = {action: INSERTION, index: i};
							else existing[key] = {
								action: MOVE,
								index: i,
								from: existing[key].index,
								element: cached.nodes[existing[key].index] || document.createElement("div")
							}
						}
					}
				}
				var actions = []
				for (var prop in existing) actions.push(existing[prop])
				var changes = actions.sort(sortChanges);
				var newCached = new Array(cached.length)
				newCached.nodes = cached.nodes.slice()

				for (var i = 0, change; change = changes[i]; i++) {
					if (change.action === DELETION) {
						clear(cached[change.index].nodes, cached[change.index]);
						newCached.splice(change.index, 1)
					}
					if (change.action === INSERTION) {
						var dummy = document.createElement("div");
						dummy.key = data[change.index].attrs.key;
						parentElement.insertBefore(dummy, parentElement.childNodes[change.index] || null);
						newCached.splice(change.index, 0, {attrs: {key: data[change.index].attrs.key}, nodes: [dummy]})
						newCached.nodes[change.index] = dummy
					}

					if (change.action === MOVE) {
						if (parentElement.childNodes[change.index] !== change.element && change.element !== null) {
							parentElement.insertBefore(change.element, parentElement.childNodes[change.index] || null)
						}
						newCached[change.index] = cached[change.from]
						newCached.nodes[change.index] = change.element
					}
				}
				cached = newCached;
			}
		}
		//end key algorithm

		for (var i = 0, cacheCount = 0, len = data.length; i < len; i++) {
			//diff each item in the array
			var item = build(parentElement, parentTag, cached, index, data[i], cached[cacheCount], shouldReattach, index + subArrayCount || subArrayCount, editable, namespace, configs);
			if (item === undefined) continue;
			if (!item.nodes.intact) intact = false;
			if (item.$trusted) {
				//fix offset of next element if item was a trusted string w/ more than one html element
				//the first clause in the regexp matches elements
				//the second clause (after the pipe) matches text nodes
				subArrayCount += (item.match(/<[^\/]|\>\s*[^<]/g) || [0]).length
			}
			else subArrayCount += type.call(item) === ARRAY ? item.length : 1;
			cached[cacheCount++] = item
		}
		if (!intact) {
			//diff the array itself
			
			//update the list of DOM nodes by collecting the nodes from each item
			for (var i = 0, len = data.length; i < len; i++) {
				if (cached[i] != null) nodes.push.apply(nodes, cached[i].nodes)
			}
			//remove items from the end of the array if the new array is shorter than the old one
			//if errors ever happen here, the issue is most likely a bug in the construction of the `cached` data structure somewhere earlier in the program
			for (var i = 0, node; node = cached.nodes[i]; i++) {
				if (node.parentNode != null && nodes.indexOf(node) < 0) clear([node], [cached[i]])
			}
			if (data.length < cached.length) cached.length = data.length;
			cached.nodes = nodes
		}
	}
	else if (data != null && dataType === OBJECT) {
		if (!data.attrs) data.attrs = {};
		if (!cached.attrs) cached.attrs = {};

		var dataAttrKeys = Object.keys(data.attrs)
		var hasKeys = dataAttrKeys.length > ("key" in data.attrs ? 1 : 0)
		//if an element is different enough from the one in cache, recreate it
		if (data.tag != cached.tag || dataAttrKeys.join() != Object.keys(cached.attrs).join() || data.attrs.id != cached.attrs.id || (module.exports.redraw.strategy() == "all" && cached.configContext && cached.configContext.retain !== true) || (module.exports.redraw.strategy() == "diff" && cached.configContext && cached.configContext.retain === false)) {
			if (cached.nodes.length) clear(cached.nodes);
			if (cached.configContext && typeof cached.configContext.onunload === FUNCTION) cached.configContext.onunload()
		}
		if (type.call(data.tag) != STRING) return;

		var node, isNew = cached.nodes.length === 0;
		if (data.attrs.xmlns) namespace = data.attrs.xmlns;
		else if (data.tag === "svg") namespace = "http://www.w3.org/2000/svg";
		else if (data.tag === "math") namespace = "http://www.w3.org/1998/Math/MathML";
		if (isNew) {
			if (data.attrs.is) node = namespace === undefined ? document.createElement(data.tag, data.attrs.is) : document.createElementNS(namespace, data.tag, data.attrs.is);
			else node = namespace === undefined ? document.createElement(data.tag) : document.createElementNS(namespace, data.tag);
			cached = {
				tag: data.tag,
				//set attributes first, then create children
				attrs: hasKeys ? setAttributes(node, data.tag, data.attrs, {}, namespace) : data.attrs,
				children: data.children != null && data.children.length > 0 ?
					build(node, data.tag, undefined, undefined, data.children, cached.children, true, 0, data.attrs.contenteditable ? node : editable, namespace, configs) :
					data.children,
				nodes: [node]
			};
			if (cached.children && !cached.children.nodes) cached.children.nodes = [];
			//edge case: setting value on <select> doesn't work before children exist, so set it again after children have been created
			if (data.tag === "select" && data.attrs.value) setAttributes(node, data.tag, {value: data.attrs.value}, {}, namespace);
			parentElement.insertBefore(node, parentElement.childNodes[index] || null)
		}
		else {
			node = cached.nodes[0];
			if (hasKeys) setAttributes(node, data.tag, data.attrs, cached.attrs, namespace);
			cached.children = build(node, data.tag, undefined, undefined, data.children, cached.children, false, 0, data.attrs.contenteditable ? node : editable, namespace, configs);
			cached.nodes.intact = true;
			if (shouldReattach === true && node != null) parentElement.insertBefore(node, parentElement.childNodes[index] || null)
		}
		//schedule configs to be called. They are called after `build` finishes running
		if (typeof data.attrs["config"] === FUNCTION) {
			var context = cached.configContext = cached.configContext || {retain: (module.exports.redraw.strategy() == "diff") || undefined};

			// bind
			var callback = function(data, args) {
				return function() {
					return data.attrs["config"].apply(data, args)
				}
			};
			configs.push(callback(data, [node, !isNew, context, cached]))
		}
	}
	else if (typeof data != FUNCTION) {
		//handle text nodes
		var nodes;
		if (cached.nodes.length === 0) {
			if (data.$trusted) {
				nodes = injectHTML(parentElement, index, data)
			}
			else {
				nodes = [document.createTextNode(data)];
				if (!parentElement.nodeName.match(voidElements)) parentElement.insertBefore(nodes[0], parentElement.childNodes[index] || null)
			}
			cached = "string number boolean".indexOf(typeof data) > -1 ? new data.constructor(data) : data;
			cached.nodes = nodes
		}
		else if (cached.valueOf() !== data.valueOf() || shouldReattach === true) {
			nodes = cached.nodes;
			if (!editable || editable !== document.activeElement) {
				if (data.$trusted) {
					clear(nodes, cached);
					nodes = injectHTML(parentElement, index, data)
				}
				else {
					//corner case: replacing the nodeValue of a text node that is a child of a textarea/contenteditable doesn't work
					//we need to update the value property of the parent textarea or the innerHTML of the contenteditable element instead
					if (parentTag === "textarea") parentElement.value = data;
					else if (editable) editable.innerHTML = data;
					else {
						if (nodes[0].nodeType === 1 || nodes.length > 1) { //was a trusted string
							clear(cached.nodes, cached);
							nodes = [document.createTextNode(data)]
						}
						parentElement.insertBefore(nodes[0], parentElement.childNodes[index] || null);
						nodes[0].nodeValue = data
					}
				}
			}
			cached = new data.constructor(data);
			cached.nodes = nodes
		}
		else cached.nodes.intact = true
	}

	return cached
}

var sortChanges = function (a, b) {return a.action - b.action || a.index - b.index}

var setAttributes = function(node, tag, dataAttrs, cachedAttrs, namespace) {
	for (var attrName in dataAttrs) {
		var dataAttr = dataAttrs[attrName];
		var cachedAttr = cachedAttrs[attrName];
		if (!(attrName in cachedAttrs) || (cachedAttr !== dataAttr)) {
			cachedAttrs[attrName] = dataAttr;
			try {
				//`config` isn't a real attributes, so ignore it
				if (attrName === "config" || attrName == "key") {
					continue;
				//hook event handlers to the auto-redrawing system
				} else if (typeof dataAttr === 'string' && attrName.indexOf('atom:') === 0) {
					node[attrName.replace('atom:', '')] = autoredraw(function(e) {
						var event = new AtomEvent(e);
						if (typeof this.value !== 'undefined') {
							event.value = this.value;
						} 
						module.exports.event.call(this, attrName.replace('atom:', ''), dataAttr, event);
					}, node);
				} else if (typeof dataAttr === FUNCTION && attrName.indexOf("on") === 0) {
					node[attrName] = autoredraw(dataAttr, node)
				}
				//handle `style: {...}`
				else if (attrName === "style" && dataAttr != null && type.call(dataAttr) === OBJECT) {
					for (var rule in dataAttr) {
						if (cachedAttr == null || cachedAttr[rule] !== dataAttr[rule]) node.style[rule] = dataAttr[rule]
					}
					for (var rule in cachedAttr) {
						if (!(rule in dataAttr)) node.style[rule] = ""
					}
				}
				//handle SVG
				else if (namespace != null) {
					if (attrName === "href") node.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataAttr);
					else if (attrName === "className") node.setAttribute("class", dataAttr);
					else node.setAttribute(attrName, dataAttr)
				}
				//handle cases that are properties (but ignore cases where we should use setAttribute instead)
				//- list and form are typically used as strings, but are DOM element references in js
				//- when using CSS selectors (e.g. `m("[style='']")`), style is used as a string, but it's an object in js
				else if (attrName in node && !(attrName === "list" || attrName === "style" || attrName === "form" || attrName === "type" || attrName === "width" || attrName === "height")) {
					//#348 don't set the value if not needed otherwise cursor placement breaks in Chrome
					if (tag !== "input" || node[attrName] !== dataAttr) node[attrName] = dataAttr
				}
				else node.setAttribute(attrName, dataAttr)
			}
			catch (e) {
				//swallow IE's invalid argument errors to mimic HTML's fallback-to-doing-nothing-on-invalid-attributes behavior
				if (e.message.indexOf("Invalid argument") < 0) throw e
			}
		}
		//#348 dataAttr may not be a string, so use loose comparison (double equal) instead of strict (triple equal)
		else if (attrName === "value" && tag === "input" && node.value != dataAttr) {
			node.value = dataAttr
		}
	}
	return cachedAttrs
}

var clear = function(nodes, cached) {
	for (var i = nodes.length - 1; i > -1; i--) {
		if (nodes[i] && nodes[i].parentNode) {
			try {nodes[i].parentNode.removeChild(nodes[i])}
			catch (e) {} //ignore if this fails due to order of events (see http://stackoverflow.com/questions/21926083/failed-to-execute-removechild-on-node)
			cached = [].concat(cached);
			if (cached[i]) unload(cached[i])
		}
	}
	if (nodes.length != 0) nodes.length = 0
}

var unload = function(cached) {
	if (cached.configContext && typeof cached.configContext.onunload === FUNCTION) {
		cached.configContext.onunload();
		cached.configContext.onunload = null
	}
	if (cached.children) {
		if (type.call(cached.children) === ARRAY) {
			for (var i = 0, child; child = cached.children[i]; i++) unload(child)
		}
		else if (cached.children.tag) unload(cached.children)
	}
}

var autoredraw = function(callback, object) {
	return function(e) {
		e = e || event;
		module.exports.redraw.strategy("diff");
		try {return callback.call(object, e)}
		finally {
			module.exports.sync();
		}
	}
}

module.exports.redraw = function(force) {
	//lastRedrawId is a positive number if a second redraw is requested before the next animation frame
	//lastRedrawID is null if it's the first redraw and not an event handler
	if (lastRedrawId && force !== true) {
		//when setTimeout: only reschedule redraw if time between now and previous redraw is bigger than a frame, otherwise keep currently scheduled timeout
		//when rAF: always reschedule redraw
		if (new Date - lastRedrawCallTime > FRAME_BUDGET || requestAnimationFrame === window.requestAnimationFrame) {
			if (lastRedrawId > 0) cancelAnimationFrame(lastRedrawId);
			lastRedrawId = requestAnimationFrame(redraw, FRAME_BUDGET)
		}
	}
	else {
		redraw();
		lastRedrawId = requestAnimationFrame(function() {lastRedrawId = null}, FRAME_BUDGET)
	}
};

module.exports.redraw.strategy = module.exports.prop();

var blank = function() {return ""}

function redraw() {
	for (var i = 0, root; root = roots[i]; i++) {
		if (controllers[i]) {
			module.exports.render(root, modules[i].view ? modules[i].view(controllers[i]) : blank())
		}
	}
	//after rendering within a routed context, we need to scroll back to the top, and fetch the document title for history.pushState
	if (computePostRedrawHook) {
		computePostRedrawHook();
		computePostRedrawHook = null
	}
	lastRedrawId = null;
	lastRedrawCallTime = new Date;
	module.exports.redraw.strategy("diff")
}

