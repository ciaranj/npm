var posix= require("posix")
var sys= require("sys");
var utils= require("utils");
var q= require("./queue");
var path= require("path");

var npmDir = process.ENV.PWD,
  HOME = process.ENV.HOME,
  npm = require("../npm");

  function fail (msg) { return function () {
      process.stdio.writeError("npm bootstrap failed: "+msg);
  }};

  function conditional_mkdir(dir_name, mode, failure) {
      return function() {
          var pm= new process.Promise();
          posix.stat(dir_name)
               .addErrback(function(){  // Need to create
                   posix.mkdir(dir_name, mode)
                        .addErrback(function() { pm.emitError() })
                        .addCallback(function() { pm.emitSuccess() });                 
               })
               .addCallback(function(stats) { // Already exists
                   if( stats.isDirectory() ) {
                       pm.emitSuccess();
                   }
                   else {
                       pm.emitError();
                   }
                });
          pm.addErrback(failure);
          return pm;
      }
  };

  function non_blocking_copy(src, dest, failure) {
      return function() {
          // try to copy the file over.
          // seems like there oughtta be a process.fs.cp
          var pm= new process.Promise();
          if( failure ) {
              pm.addErrback(failure);
          }
          posix.cat( src )
               .addErrback(fail("couldn't read " + src))
               .addCallback(function (content) {
                   posix.open(dest, process.O_WRONLY | process.O_TRUNC | process.O_CREAT, 0666)
                        .addErrback(fail("couldn't open "+dest+" for writing"))
                        .addCallback(function (fd) {
                            posix.write(fd, content, 0)
                                 .addErrback(fail("couldn't write to "+ dest))
                                 .addCallback(function(){pm.emitSuccess();})
                        })

               })
          return pm;
      }
  };
  

var script = [
  function () {
      sys.puts("npm: bootstrapping");
  },
  
  // make sure that the ~/.node_libraries and ~/.npm exist.
  conditional_mkdir(path.join(HOME, ".npm"), 0755, fail("couldn't create " + path.join(HOME, ".npm")) ),
  conditional_mkdir(path.join(HOME, ".node_libraries"), 0755, fail("couldn't create " + path.join(HOME, ".node_libraries")) ),
  non_blocking_copy(path.join(npmDir, "sources.json"), path.join(HOME, ".npm", "sources.json")),
  
  // call npm.install("--force", "npm")
  function () {
    npm.install("npm", {force : true}).addErrback(fail(
      "Failed installing npm with npm"
    ));
  }
];

exports.bootstrap = function bootstrap () {
  var bootStrapQueue=  q.queue(script, function(item) {
      return item();
  }).addCallback(function () {
      process.stdio.write("ok");
  });
}
