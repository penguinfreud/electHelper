var fs = require("fs"),
http = require("http");

function parseArgs() {
	var args = process.argv;
	var i, l = args.length, arg;
	var options = {};
	
	for (i = 2; i<l; i++) {
		arg = args[i];
		if (arg == "-h" || arg == "--help") {
			usage();
		} else if (arg == "-c") {
			options.config = args[++i];
		} else if (arg == "-u") {
			options.user = args[++i];
		} else if (arg == "-p") {
			options.password = args[++i];
		} else if (arg == "-i") {
			options.interval = parseInt(args[++i]);
		} else if (arg == "-e") {
			options.courses = args[++i].split(",");
		} else if (arg == "-s") {
			options.server = parseInt(args[++i]);
		} else {
			console.log("unknonw option: " + arg);
			usage();
		}
	}
	
	return options;
}

function usage() {
	console.log("node main.js [-c <config file>] [-u id] [-p password] [-i interval] [-s <server no.>] [-e <course1>,<course2>,...]");
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
	if (options.interval == -1) {
		options.interval = 600;
	} else if (options.interval <= 0) {
		console.log("invalid interval: " + interval);
		return false;
	}
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
	validate(options) || process.exit();
}

var options = {
	interval: -1,
	user: null,
	password: null,
	courses: null,
	server: 1
},
sessionId = null,
blocking = 0,
loggedIn = false,
courseData,
lessonCounts,
electedCourses,
byId, byNo;

exports.options = options;

exports.getSessionId = function () {
	return sessionId;
};

exports.reset = function () {
	blocking = 0;
};

exports.getCourseData = function () {
	return courseData;
};

exports.getLessonCounts = function () {
	return lessonCounts;
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
	return headers;
}

function request(obj, cb, fail) {
	++blocking;
	
	obj.headers = prepareHeaders(obj.headers);
	
	var req = http.request(obj);
	
	req.on("abort", function () {
		console.log("Error");
		console.log(new Error().stack);
		fail && process.nextTick(fail);
		--blocking;
	});
	
	req.on("response", function (res) {
		var setCookie = res.headers["set-cookie"];
		if (setCookie) {
			var s = setCookie[0];
			if (s.substr(0, 10) == "JSESSIONID") {
				var i = s.indexOf(";");
				sessionId = s.substring(11, i);
				console.log("session id: " + sessionId);
			}
		}
		if (res.statusCode == 302 && res.headers.location == "http://xk.fudan.edu.cn/xk/login.action") {
			login();
			fail && process.nextTick(fail);
			--blocking;
		} else {
			cb(res);
			--blocking;
		}
	});
	
	return req;
}

function login(succeed, fail) {
	if (blocking > 0) return;
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
		if (res.statusCode == 302) {
			loginPhase2(succeed, fail);
		} else {
			console.log("login failed");
			fail && process.nextTick(fail);
		}
	}, fail);
	
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
			electedCourses = [];
			while (true) {
				i = data.indexOf("electedIds[\"l", i+1);
				if (i == -1) break;
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

function loadData(success) {
	if (blocking > 0) return;
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
			courseData = eval(content.substr(content.indexOf("{")));
			prepareData();
			convertElectedCourses();
			console.log("data loaded");
			succeed && process.nextTick(succeed);
		});
	}, function () {
		loadData(success);
	}).end();
}

exports.loadData = loadData;

function prepareData() {
	var i, course;
	for (i = 0; i<courseData.length; i++) {
		course = courseData[i];
		byId[course.id] = course;
		byNo[course.no] = course;
	}
}

function convertElectedCourses() {
	if (courseData && electedCourses.length > 0 && typeof electedCourses[0] == "number") {
		var i;
		for (i = 0; i<electedCourses.length; i++) {
			electedCourses[i] = byId[electedCourses[i]];
		}
}

function loadCounts(success) {
	if (blocking > 0) return;
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
			lessonCounts = eval(content.substr(content.indexOf("{")));
			process.stdout.write("@");
			succeed && process.nextTick(succeed);
		});
	}, function () {
		loadCounts(success);
	}).end();
}

exports.loadCounts = loadCounts;

function elect(course, isQuit) {
	if (blocking) return;
	var body = isQuit?
		"optype=false&operator0=" + course.id + "%3Afalse":
		"optype=true&operator0=" + course.id + "%3Atrue%3A0";
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
		if (res.statusCode == 200) {
			var data = "";
			res.on("data", function (chunk) {
				data += chunk.toString();
			});
			res.on("end", function () {
				if (data.indexOf("success") >= 0) {
					console.log("\nelected " + course.no + " " + course.name);
					courses.splice(courses.indexOf(course.id), 1);
				} else if (data.indexOf("Please DO NOT click too quickly.") >= 0) {
					console.log("\ntoo quick");
				}
			});
		}
	});
	
	req.write(body);
	req.end();
}

exports.elect = elect;

