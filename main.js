var fs = require("fs"),
http = require("http");

function parseArgs() {
	var args = process.argv;
	var i, l = args.length, arg;
	var options = {};
	
	for (i = 2; i<l; i++) {
		arg = args[i];
		if (arg === "-h" || arg === "--help") {
			usage();
		} else if (arg === "-c") {
			options.config = args[++i];
		} else if (arg === "-u") {
			options.user = args[++i];
		} else if (arg === "-p") {
			options.password = args[++i];
		} else if (arg === "-i") {
			options.interval = parseInt(args[++i]);
		} else if (arg === "-e") {
			options.courses = args[++i].split(",");
		} else if (arg === "-s") {
			options.server = parseInt(args[++i]);
		} else {
			console.log("unknonw option: " + arg);
			usage();
		}
	}
	
	return options;
}

function usage() {
	console.log("node main.js [-c <config file>] [-u <id>] [-p <password>] [-i <check interval>] [-s <server no.>] [-e <course1>,<course2>,...]");
	process.exit();
}

function validate(options) {
	if (!/^1[2-5]3[0-9]{8}$/.test(options.user)) {
		console.log("invalid user id: " + options.user);
		return false;
	}
	if (!options.user) {
		console.log("no user id specified");
		return false;
	}
	if (!options.password) {
		console.log("no password specified");
		return false;
	}
	if (options.interval === -1) {
		options.interval = 250;
	} else if (options.interval <= 0) {
		console.log("invalid interval: " + options.interval);
		return false;
	}
	if (options.interval < 200) {
		console.log("warning: interval " + options.interval + " may be too short");
	}
	if (!options.courses) options.courses = [];
	if (!options.conflicts) options.conflicts = [];
	return true;
}

function getOptions() {
	var args = parseArgs();
	if (args.config) {
		var json = JSON.parse(fs.readFileSync(args.config, { encoding: "UTF-8" }));
		
		var key;
		for (key in json) {
			if (options.hasOwnProperty(key)) {
				options[key] = json[key];
			}
		}
	}
	for (var key in args) {
		if (options.hasOwnProperty(key)) {
			options[key] = args[key];
		}
	}
}

var options = {
	interval: -1,
	user: null,
	password: null,
	courses: null,
	conflicts: null,
	server: 1
},
sessionId = null,
loggingIn = false,
loggedIn = false,
courseData,
lessonCounts,
electedCourses,
wantedCourses;

exports.options = options;

exports.getSessionId = function () {
	return sessionId;
};

exports.reset = function () {
	loggingIn = false;
};

function prepareHeaders(headers) {
	headers["User-Agent"] = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:43.0) Gecko/20100101 Firefox/43.0";
	headers["Accept"] = "text/html, */*; q=0.01";
	headers["Accept-Language"] = "en-US,en;q=0.5";
	if (sessionId) {
		headers["Cookie"] = "JSESSIONID=" + sessionId + "; SVRNAME=xk" + options.server;
	} else {
		headers["Cookie"] = "SVRNAME=xk" + options.server;
	}
}

function request(obj, cb, fail, isLogin) {
	if (isLogin) loggingIn = true;
	
	prepareHeaders(obj.headers);
	
	var req = http.request(obj);
	
	req.on("abort", function () {
		console.log("Error");
		console.log(new Error().stack);
		fail && process.nextTick(fail);
		if (isLogin) loggingIn = false;
	});
	
	req.on("response", function (res) {
		var setCookie = res.headers["set-cookie"];
		if (setCookie) {
			var s = setCookie[0];
			if (s.substr(0, 10) === "JSESSIONID") {
				var i = s.indexOf(";");
				sessionId = s.substring(11, i);
				console.log("session id: " + sessionId);
			}
		}
		if (res.statusCode === 302 && res.headers.location === "http://xk.fudan.edu.cn/xk/login.action") {
			login();
			fail && process.nextTick(fail);
			if (isLogin) loggingIn = false;
		} else {
			cb(res);
			if (isLogin) loggingIn = false;
		}
	});
	
	return req;
}

function login(succeed, fail) {
	if (loggingIn) return;
	console.log("login");
	loggedIn = false;
	
	var body = "username=" + encodeURIComponent(options.user) +
        "&password=" + encodeURIComponent(options.password) +
        "&encodedPassword=&session_locale=en_US";
	
	var req = request({
		method: "POST",
		hostname: "xk.fudan.edu.cn",
		path: "/xk/login.action",
		headers: {
			"Referer": "http://xk.fudan.edu.cn/xk/login.action",
			"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
			"Content-Length": body.length
		}
	}, function (res) {
		if (res.statusCode === 302) {
			loginPhase2(succeed, fail);
		} else {
			console.log("login failed");
			fail && process.nextTick(fail);
		}
	}, fail, true);
	
	req.write(body);
	req.end();
}

exports.login = login;

function loginPhase2(succeed, fail) {
	request({
		method: "GET",
		hostname: "xk.fudan.edu.cn",
		path: "/xk/stdElectCourse.action",
		headers: {
			"Referer": "http://xk.fudan.edu.cn/xk/login.action"
		}
	}, function (res) {
		loginPhase3(succeed, fail);
	}, fail).end();
}

function loginPhase3(succeed, fail) {
	request({
		method: "GET",
		hostname: "xk.fudan.edu.cn",
		path: "/xk/stdElectCourse!defaultPage.action?electionProfile.id=141",
		headers: {
			"Referer": "http://xk.fudan.edu.cn/xk/login.action",
		}
	}, function (res) {
		var data = "";
		res.on("data", function (chunk) {
			data += chunk.toString("UTF-8");
		});
		res.on("end", function () {
			var i = 0, j, l = data.length;
			exports.electedCourses = electedCourses = [];
			while (true) {
				i = data.indexOf("electedIds[\"l", i+1);
				if (i === -1) break;
				j = data.indexOf("\"]", i);
				electedCourses.push(parseInt(data.substring(i + 13, j)));
			}
			convertElectedCourses();
		});
		
		console.log("login succeeded");
		loggedIn = true;
		succeed && process.nextTick(succeed);
	}, fail).end();
}

function loadData(succeed) {
	if (loggingIn) return;
	request({
		method: "GET",
		hostname: "xk.fudan.edu.cn",
		path: "/xk/stdElectCourse!data.action?profileId=141",
		headers: {
			"Referer": "http://xk.fudan.edu.cn/xk/stdElectCourse!defaultPage.action?electionProfile.id=141"
		}
	}, function (res) {
		var content = "";
		res.on("data", function (chunk) {
			content += chunk.toString("UTF-8");
		});
		res.on("end", function () {
			exports.courseData = courseData = eval(content.substr(content.indexOf("[")));
			console.log("data loaded");
			prepareData();
			convertElectedCourses();
			convertWantedCourses();
			checkConflict();
			succeed && succeed();
		});
	}, function () {
		loadData(succeed);
	}).end();
}

exports.loadData = loadData;

function prepareData() {
	exports.byId = byId = {};
	exports.byNo = byNo = {};
	var i, course;
	for (i = 0; i<courseData.length; i++) {
		course = courseData[i];
		byId[course.id] = course;
		byNo[course.no] = course;
	}
}

function convertElectedCourses() {
	if (courseData && electedCourses.length > 0 && typeof electedCourses[0] === "number") {
		var i, course;
		for (i = 0; i<electedCourses.length; i++) {
			course = electedCourses[i] = byId[electedCourses[i]];
			course.elected = true;
			console.log("elected: " + course.no + " " + course.name);
		}
	}
}

function convertWantedCourses() {
	if (courseData) {
		var i, course, no;
		exports.wantedCourses = wantedCourses = [];
		for (i = 0; i<options.courses.length; i++) {
			course = byNo[options.courses[i]];
			if (course) {
				wantedCourses.push(course);
				console.log("added to list: " + course.no + " " + course.name);
			} else {
				console.log("course not found: " + options.courses[i]);
			}
		}
	}
}

function loadCounts(succeed) {
	if (loggingIn) return;
	request({
		method: "GET",
		 hostname: "xk.fudan.edu.cn",
		 path: "/xk/stdElectCourse!queryStdCount.action?projectId=1&semesterId=202",
		 headers: {
			 "Referer": "http://xk.fudan.edu.cn/xk/stdElectCourse!defaultPage.action?electionProfile.id=141"
		 }
	}, function (res) {
		var content = "";
		res.on("data", function (chunk) {
			content += chunk.toString("UTF-8");
		});
		res.on("end", function () {
			if (content.substr(0, 4) == "/*sc") {
				exports.lessonCounts = lessonCounts = eval("(" + content.substr(content.indexOf("{")) + ")");
				process.stdout.write("@");
				triggerPollEvent();
				succeed && succeed();
			} else {
				process.stdout.write("!");
			}
		});
	}, function () {
		loadCounts(succeed);
	}).end();
}

exports.loadCounts = loadCounts;

var pollListeners = exports.pollListeners = [];

function triggerPollEvent() {
	var i;
	for (i = 0; i<pollListeners.length; i++) {
		pollListeners[i]();
	}
}

var Enum = 0;
var ELECTING = ++Enum,
ELECTED = ++Enum,
DROPPING = ++Enum,
UNELECTED = ++Enum;

function resetState(course) {
	course.state = course.elected? ELECTED: UNELECTED;
}

function elect(course, isDrop, succeed, fail) {
	if (!course.state) resetState(course);
	if (loggingIn || course.state !== (isDrop? ELECTED: UNELECTED)) return;
	
	var body = isDrop?
	"optype=false&operator0=" + course.id + "%3Afalse":
	"optype=true&operator0=" + course.id + "%3Atrue%3A0";
	
	course.state = ELECTING;
	
	//console.log((isDrop? "dropping ": "electing ") + course.no + " " + course.name);
	process.stdout.write(".");
	
	var req = request({
		method: "POST",
		host: "xk.fudan.edu.cn",
		path: "/xk/stdElectCourse!batchOperator.action?profileId=141",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
			"X-Requested-With": "XMLHttpRequest",
			"Referer": "http://xk.fudan.edu.cn/xk/stdElectCourse!defaultPage.action?electionProfile.id=141",
			"Content-Length": body.length + ""
		}
	}, function (res) {
		if (res.statusCode === 200) {
			var data = "";
			res.on("data", function (chunk) {
				data += chunk.toString();
			});
			res.on("end", function () {
				var message = (data.match(/<div[^>]*>((?:.|[\r\n])*)<\/div>/m) || [,""])[1];
				if (data.indexOf("success") >= 0) {
					if (isDrop) {
						console.log("\ndropped " + course.no + " " + course.name);
						course.elected = false;
						course.state = UNELECTED;
						electedCourses.splice(electedCourses.indexOf(course), 1);
					} else {
						console.log("\nelected " + course.no + " " + course.name);
						course.elected = true;
						course.state = ELECTED;
						electedCourses.push(course);
					}
					succeed && succeed();
				} else if (data.indexOf("Please DO NOT click too quickly.") >= 0 ||
					data.indexOf("服务器内部错误") >= 0) {
					process.stdout.write("*");
					resetState(course);
					fail && fail();
				} else if (message.indexOf("公选人数已满") >= 0) {
					process.stdout.write("|");
					resetState(course);
					fail && fail();
				} else if (data.indexOf("failure") >= 0) {
					resetState(course);
					console.log(message);
					fail && fail();
				} else {
					resetState(course);
					console.log(message);
					fail && fail();
				}
			});
		}
	}, function () {
		resetState(course);
		fail();
	});
	
	req.write(body);
	req.end();
}

exports.elect = elect;

function timeConflict(a, b) {
	var units = {}, i, o, j;
	for (i = 0; i < a.arrangeInfo.length; i++) {
		o = a.arrangeInfo[i];
		for (j = o.startUnit; j<o.endUnit; j++) {
			units[o.weekDay * 15 + j] = 1;
		}
	}
	
	for (i = 0; i < b.arrangeInfo.length; i++) {
		o = b.arrangeInfo[i];
		for (j = o.startUnit; j<o.endUnit; j++) {
			if (units[o.weekDay * 15 + j] === 1) {
				return true;
			}
		}
	}
	
	return false;
}

exports.timeConflict = timeConflict;

function userDefinedConflict(a, b) {
	var i, con;
	for (i = 0; i<options.conflicts; i++) {
		con = options.conflicts[i];
		if (con.indexOf(a) >= 0 && con.indexOf(b) >= 0) {
			return true;
		}
	}
	return false;
}

function conflict(a, b) {
	return timeConflict(a, b) || userDefinedConflict(a, b);
}

function checkTimeConflict() {
	var i, j, a, b;
	for (i = 0; i<wantedCourses.length; i++) {
		a = wantedCourses[i];
		if (!a.conflictsWith) a.conflictsWith = [];
		for (j = 0; j<electedCourses.length; j++) {
			b = electedCourses[j];
			if (a !== b && timeConflict(a, b)) {
				a.conflictsWith.push(b);
				console.log(a.no + " " + a.name + " conflicts with elected course " + b.no + " " + b.name);
			}
		}
		for (j = i + 1; j<wantedCourses.length; j++) {
			b = wantedCourses[j];
			if (!b.elected && timeConflict(a, b)) {
				a.conflictsWith.push(b);
				console.log(a.no + " " + a.name + " conflicts with " + b.no + " " + b.name);
			}
		}
	}
}

function getCredits() {
	var i, credits = 0;
	for (i = 0; i<electedCourses.length; i++) {
		credits += electedCourses[i].credits;
	}
	return credits;
}

function checkConflict() {
	checkTimeConflict();
	console.log("current credits: " + getCredits());
}

var constraints = exports.constraints = [
	function (course, toDrop) {
		var credits = course.credits + getCredits();
		if (credits > 32) {
			console.log("credits exceeded 32");
			var j = wantedCourses.indexOf(course);
			//console.log(course.no + " " + course.name + " is not found in list, assigned highest priority by default");
			if (j === -1) return false;
			var c, i;
			for (i = wantedCourses.length - 1; i>j && credits > 32; i--) {
				c = wantedCourses[i];
				if (c.elected) {
					toDrop.push(c);
					credits -= c.credits;
				}
			}
			if (credits > 32) {
				console.log("cannot find a course to drop, electing failed");
				return false;
			}
		}
		return true;
	},
	
	function (course, toDrop) {
		var i, c, p1, p2;
		for (i = 0; i<electedCourses.length; i++) {
			c = electedCourses[i];
			if (conflict(course, c)) {
				p1 = wantedCourses.indexOf(course);
				p2 = wantedCourses.indexOf(c);
				if (p1 !== -1 && p2 !== -1 && p1 < p2) {
					toDrop.push(c);
				} else {
					return false;
				}
			}
		}
		return true;
	}
];

pollListeners.push(function () {
	var i, j, c, count, toDrop;
	loop: for (i = 0; i<wantedCourses.length; i++) {
		c = wantedCourses[i];
		count = lessonCounts[c.id];
		if (!c.state) resetState(c);
		if (c.state === UNELECTED &&
			count.sc < count.lc) {
			toDrop = [];
			for (j = 0; j<constraints.length; j++) {
				if (!constraints[j](c, toDrop)) {
					console.log("unmet constraint");
					continue loop;
				}
			}
			if (toDrop.length === 0) {
				elect(c);
				return;
			} else {
				elect(toDrop[0], true);
				return;
			}
		}
	}
});

function run(cb) {
	function _cb() {
		run(cb);
	}
	if (validate(options)) {
		if (!loggedIn) {
			login(_cb);
		} else if (!courseData) {
			loadData(_cb);
		} else {
			loadCounts(cb);
		}
	}
}

exports.run = run;

var main = exports.main = function () {
	getOptions();
	run(function () {
		setInterval(loadCounts, options.interval);
	});
}

if (require.main === module) {
	main();
}

