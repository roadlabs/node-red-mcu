/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

/*
	Modified for Node-RED MCU

		- move TriggerNode to top level (reduces RAM use)
		- use __op1 and __op2 (created by nodered2mcu) to access properties instead of RED.util.evaluateNodeProperty  
		- import mustache instead of using require
		- op1/op2 type/value mapping moved to nodered2mcu
	
	To do

		- use Map, instead of object, for node.topics and node.npay
*/

import mustache from "mustache";
function TriggerNode(n) {
	RED.nodes.createNode(this,n);
	this.__op1 = n.__op1;
	this.__op2 = n.__op2;
	this.bytopic = n.bytopic || "all";
/*
	this.op1 = n.op1 || "1";
	this.op2 = n.op2 || "0";
	this.op1type = n.op1type || "str";
	this.op2type = n.op2type || "str";
*/
	this.op1 = n.op1;
	this.op2 = n.op2;
	this.op1type = n.op1type;
	this.op2type = n.op2type;
	this.second = (n.outputs == 2) ? true : false;
	this.topic = n.topic || "topic";
/*
	if (this.op1type === 'val') {
		if (this.op1 === 'true' || this.op1 === 'false') {
			this.op1type = 'bool'
		} else if (this.op1 === 'null') {
			this.op1type = 'null';
			this.op1 = null;
		} else {
			this.op1type = 'str';
		}
	}
	if (this.op2type === 'val') {
		if (this.op2 === 'true' || this.op2 === 'false') {
			this.op2type = 'bool'
		} else if (this.op2 === 'null') {
			this.op2type = 'null';
			this.op2 = null;
		} else {
			this.op2type = 'str';
		}
	}
*/
	this.extend = n.extend || "false";
	this.overrideDelay = n.overrideDelay || false;
	this.units = n.units || "ms";
	this.reset = n.reset || '';
	this.duration = parseFloat(n.duration);
	if (isNaN(this.duration)) {
		this.duration = 250;
	}
	if (this.duration < 0) {
		this.loop = true;"p"
		this.duration = this.duration * -1;
		this.extend = false;
	}

	if (this.units == "s") { this.duration = this.duration * 1000; }
	if (this.units == "min") { this.duration = this.duration * 1000 * 60; }
	if (this.units == "hr") { this.duration = this.duration * 1000 *60 * 60; }

//	this.op1Templated = (this.op1type === 'str' && this.op1.indexOf("{{") != -1);
//	this.op2Templated = (this.op2type === 'str' && this.op2.indexOf("{{") != -1);
	if (n.op1Templated) this.op1Templated = true;
	if (n.op2Templated) this.op2Templated = true;
//	if ((this.op1type === "num") && (!isNaN(this.op1))) { this.op1 = Number(this.op1); }
//	if ((this.op2type === "num") && (!isNaN(this.op2))) { this.op2 = Number(this.op2); }
	//if (this.op1 == "null") { this.op1 = null; }
	//if (this.op2 == "null") { this.op2 = null; }
	//try { this.op1 = JSON.parse(this.op1); }
	//catch(e) { this.op1 = this.op1; }
	//try { this.op2 = JSON.parse(this.op2); }
	//catch(e) { this.op2 = this.op2; }

	var node = this;
	node.topics = {};

	var npay = {};
	var pendingMessages = [];
	var activeMessagePromise = null;
	var processMessageQueue = function(msgInfo) {
		if (msgInfo) {
			// A new message has arrived - add it to the message queue
			pendingMessages.push(msgInfo);
			if (activeMessagePromise !== null) {
				// The node is currently processing a message, so do nothing
				// more with this message
				return;
			}
		}
		if (pendingMessages.length === 0) {
			// There are no more messages to process, clear the active flag
			// and return
			activeMessagePromise = null;
			return;
		}

		// There are more messages to process. Get the next message and
		// start processing it. Recurse back in to check for any more
		var nextMsgInfo = pendingMessages.shift();
		activeMessagePromise = processMessage(nextMsgInfo)
			.then(processMessageQueue)
			.catch((err) => {
				nextMsgInfo.done(err);
				return processMessageQueue();
			});
	}

	this.on('input', function(msg, send, done) {
		processMessageQueue({msg, send, done});
	});

	var stat = function() {
		var l = Object.keys(node.topics).length;
		if (l === 0) { return {} }
		else if (l === 1) { return {fill:"blue",shape:"dot"} }
		else return {fill:"blue",shape:"dot",text:l};
	}

	var processMessage = function(msgInfo) {
		let msg = msgInfo.msg;
		var topic = RED.util.getMessageProperty(msg,node.topic) || "_none";
		var promise;
		var delayDuration = node.duration;
		if (node.overrideDelay && msg.hasOwnProperty("delay") && !isNaN(parseFloat(msg.delay))) {
			delayDuration = parseFloat(msg.delay);
		}
		if (node.bytopic === "all") { topic = "_none"; }
		node.topics[topic] = node.topics[topic] || {};
		if (msg.hasOwnProperty("reset") || ((node.reset !== '') && msg.hasOwnProperty("payload") && (msg.payload !== null) && msg.payload.toString && (msg.payload.toString() == node.reset)) ) {
			if (node.loop === true) { clearInterval(node.topics[topic].tout); }
			else { clearTimeout(node.topics[topic].tout); }
			delete node.topics[topic];
			node.status(stat());
		}
		else {
			if (node.op2type === "payl") { npay[topic] = RED.util.cloneMessage(msg); }
			if (((!node.topics[topic].tout) && (node.topics[topic].tout !== 0)) || (node.loop === true)) {
				promise = Promise.resolve();
				if (node.op2type === "pay") { node.topics[topic].m2 = RED.util.cloneMessage(msg.payload); }
				else if (node.op2Templated) { node.topics[topic].m2 = mustache.render(node.op2,msg); }
				else if (node.op2type !== "nul") {
					node.topics[topic].m2 = node.__op2();
/*
					promise = new Promise((resolve,reject) => {
						RED.util.evaluateNodeProperty(node.op2,node.op2type,node,msg,(err,value) => {
							if (err) {
								reject(err);
							} else {
								node.topics[topic].m2 = value;
								resolve();
							}
						});
					});
*/
				}

				return promise.then(() => {
					promise = Promise.resolve();
					if (node.op1type === "pay") { }
					else if (node.op1Templated) { msg.payload = mustache.render(node.op1,msg); }
					else if (node.op1type !== "nul") {
						msg.payload = node.__op1();
/*
						promise = new Promise((resolve,reject) => {
							RED.util.evaluateNodeProperty(node.op1,node.op1type,node,msg,(err,value) => {
								if (err) {
									reject(err);
								} else {
									msg.payload = value;
									resolve();
								}
							});
						});
*/
					}
					return promise.then(() => {
						if (delayDuration === 0) { node.topics[topic].tout = 0; }
						else if (node.loop === true) {
							/* istanbul ignore else  */
							if (node.topics[topic].tout) { clearInterval(node.topics[topic].tout); }
							/* istanbul ignore else  */
							if (node.op1type !== "nul") {
								var msg2 = RED.util.cloneMessage(msg);
								node.topics[topic].tout = setInterval(function() {
									if (node.op1type === "date") { msg2.payload = Date.now(); }
									msgInfo.send(RED.util.cloneMessage(msg2));
								}, delayDuration);
							}
						}
						else {
							if (!node.topics[topic].tout) {
								node.topics[topic].tout = setTimeout(function() {
									var msg2 = null;
									if (node.op2type !== "nul") {
										var promise = Promise.resolve();
										msg2 = RED.util.cloneMessage(msg);
										if (node.op2type === "flow" || node.op2type === "global") {
											node.topics[topic].m2 = node.__op2();
/*
											promise = new Promise((resolve,reject) => {
												RED.util.evaluateNodeProperty(node.op2,node.op2type,node,msg,(err,value) => {
													if (err) {
														reject(err);
													} else {
														node.topics[topic].m2 = value;
														resolve();
													}
												});
											});
*/
										}
										promise.then(() => {
											if (node.op2type === "payl") {
												if (node.second === true) { msgInfo.send([null,npay[topic]]); }
												else { msgInfo.send(npay[topic]); }
												delete npay[topic];
											}
											else {
												msg2.payload = node.topics[topic].m2;
												if (node.op2type === "date") { msg2.payload = Date.now(); }
												if (node.second === true) { msgInfo.send([null,msg2]); }
												else { msgInfo.send(msg2); }
											}
											delete node.topics[topic];
											node.status(stat());
										}).catch(err => {
											node.error(err);
										});
									} else {
										delete node.topics[topic];
										node.status(stat());
									}

								}, delayDuration);
							}
						}
						msgInfo.done();
						node.status(stat());
						if (node.op1type !== "nul") { msgInfo.send(RED.util.cloneMessage(msg)); }
					});
				});
			}
			else if ((node.extend === "true" || node.extend === true) && (delayDuration > 0)) {
				/* istanbul ignore else  */
				if (node.op2type === "payl") { node.topics[topic].m2 = RED.util.cloneMessage(msg.payload); }
				/* istanbul ignore else  */
				if (node.topics[topic].tout) { clearTimeout(node.topics[topic].tout); }
				node.topics[topic].tout = setTimeout(function() {
					var msg2 = null;
					var promise = Promise.resolve();

					if (node.op2type !== "nul") {
						if (node.op2type === "flow" || node.op2type === "global") {
							node.topics[topic].m2 = node.__op2();
/*
							promise = new Promise((resolve,reject) => {
								RED.util.evaluateNodeProperty(node.op2,node.op2type,node,msg,(err,value) => {
									if (err) {
										reject(err);
									} else {
										node.topics[topic].m2 = value;
										resolve();
									}
								});
							});
*/
						}
					}
					promise.then(() => {
						if (node.op2type !== "nul") {
							if (node.topics[topic] !== undefined) {
								msg2 = RED.util.cloneMessage(msg);
								msg2.payload = node.topics[topic].m2;
							}
						}
						delete node.topics[topic];
						node.status(stat());
						if (node.second === true) { msgInfo.send([null,msg2]); }
						else { msgInfo.send(msg2); }
					}).catch(err => {
						node.error(err);
					});
				}, delayDuration);
			}
			// else {
			//     if (node.op2type === "payl") {node.topics[topic].m2 = RED.util.cloneMessage(msg.payload); }
			// }
		}
		msgInfo.done();
		return Promise.resolve();
	}
	this.on("close", function() {
		for (var t in node.topics) {
			/* istanbul ignore else  */
			if (node.topics[t]) {
				if (node.loop === true) { clearInterval(node.topics[t].tout); }
				else { clearTimeout(node.topics[t].tout); }
				delete node.topics[t];
			}
		}
		node.status(stat());
	});
}
RED.nodes.registerType("trigger",TriggerNode);

