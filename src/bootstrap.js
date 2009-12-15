// @TODO: Use the ./queue.js util for this.
var posix= require("posix")
var sys= require("sys");
var utils= require("utils");

var npmDir = process.ENV.PWD,
  HOME = process.ENV.HOME,
  npm = require("../npm"),
  queuePromise = new process.Promise();
 
exports.bootstrap = function bootstrap () {
  process.stdio.writeError("npm: bootstrapping\n");
  queuePromise.addCallback(function () {
    process.stdio.write("ok");
  });
  next();
}

function statTester (thing, test, success, failure) {
  return function () {
    posix.stat(thing).addCallback(function (stats) {
      return (stats[test]()) ? success.apply(this, arguments)
        : failure.apply(this, arguments);
    }).addErrback(failure);
  };
};
// mkdir if not already existent.
// Doesn't handle mkdir -p, which would be nice, but is not necessary for this
function dirMaker (dir, mode, success, failure) {
  return statTester(dir, "isDirectory", success, function () {
    posix.mkdir(dir, mode).addErrback(failure).addCallback(success);
  });
};

function fail (msg) { return function () {
    process.stdio.writeError("npm bootstrap failed: "+msg);
}}

function next () {
  return script.shift()();
}

function done () {
  queuePromise.emitSuccess();
}


var script = [
  // make sure that the ~/.node_libraries and ~/.npm exist.
  dirMaker(require("path").join(HOME, ".node_libraries"), 0755, next, fail(
    "couldn't create " +require("path").join(HOME, ".node_libraries")
  )),
  dirMaker(require("path").join(HOME, ".node_libraries","npm_libs"), 0755, next, fail(
    "couldn't create " +require("path").join(HOME, ".node_libraries", "npm_libs")
  )),
  dirMaker(require("path").join(HOME, ".npm"), 0755, next, fail(
    "couldn't create " + require("path").join(HOME, ".npm")
  )),
  // If no in ~/.npm/sources.json, then copy over the local one
  statTester(
    require("path").join(HOME, ".npm", "sources.json"), "isFile", next,
    function () {
      // try to copy the file over.
      // seems like there oughtta be a process.fs.cp
      posix.cat(
        require("path").join(npmDir, "sources.json")
      ).addErrback(fail(
        "couldn't read " + require("path").join(npmDir, "sources.json")
      )).addCallback(function (content) {
        posix.open(
          require("path").join(HOME, ".npm", "sources.json"),
          process.O_WRONLY | process.O_TRUNC | process.O_CREAT,
          0666
        ).addErrback(fail(
          "couldn't open "+require("path").join(HOME, ".npm", "sources.json")+" for writing"
        )).addCallback(function (fd) {
          posix.write(fd, content, 0).addErrback(fail(
            "couldn't write to "+require("path").join(HOME, ".npm", "sources.json")
          )).addCallback(next);
        });
      });
    }
  ),
  
  // call npm.install("--force", "npm")
  function () {
    npm.install("npm", {force : true}).addErrback(fail(
      "Failed installing npm with npm"
    )).addCallback(next);
  },
  
  done
];
  
