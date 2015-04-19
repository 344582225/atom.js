
'use strict';

/**
 * Module constructor.
 */

var Contact = { };

Contact.controller = function() {
	this.buttonClickCount = 0;
	this.buttonTxt = 'Click Me';
	this.inputTxt = 'value here';
}

Contact.view = function(controller, v) {
	return [
		v('input', {
			type: 'text',
			value: controller.inputTxt,
			oninput: function(e) {
				controller.inputTxt = e.value;
			}
		}),
		v('button.test', {
			id: 'testing',
			onclick: function(e) {
				controller.buttonClickCount++;
				controller.buttonTxt = 'You have clicked this button for ' + controller.buttonClickCount + ' time(s).';
			}
		}, controller.buttonTxt),
		v('button.reset', {
			onclick: function(e) {
				controller.buttonClickCount = 0;
				controller.buttonTxt = 'Click Me';
				controller.inputTxt = 'value here';
			}
		}, 'Reset Button')
	];
}

Contact.model = function() {

}

module.exports = Contact;