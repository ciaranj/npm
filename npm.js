// the main guts

// @TODO Don't fetch the whole catalog.json file.
// Use the split-up single-package files instead.

var npm = exports;
var http = require("/http.js");

node.mixin(require("/utils.js"));
node.mixin(require("./src/queue.js"));
node.mixin(require("./src/fetch.js"));

var CATALOG = {};
var REQS = [], INSTALL_SET = {}, INSTALL_OPTS = {};

function buildInstallSet (pkg) {
  var p = new node.Promise();
  var REQS = [pkg];
  var INSTALL_SET = {};
  var WAITING = 0;
  
  setTimeout(function installSetBuilder () {
    var set = INSTALL_SET
    if (REQS.length === 0) {
      // done, move onto next phase.
      p.emitSuccess(set);
      return;
    }
    var pkg = REQS.shift();
    // log("--- pkg = "+pkg);
    if (set.hasOwnProperty(pkg)) {
      // just pass by this one.
      setTimeout(installSetBuilder);
    } else {
      // log("not already in set: "+pkg);
      WAITING ++;
      set[pkg] = npm.readCatalog(pkg);
      set[pkg].addErrback(fail(p, "Failed to fetch catalog data for "+pkg));
      set[pkg].addCallback(function (data) {
        WAITING --;
        log(pkg, "adding");
        set[pkg] = data;
        if (data.hasOwnProperty("require")) {
          REQS = REQS.concat(data.require);
          setTimeout(installSetBuilder);
        } else if (WAITING <= 0) p.emitSuccess(set);
      });
    }
  });
  
  return p;
};


npm.installPackages = function npm_installPackages (set, opt) {
  var p = new node.Promise();
  
  stack(set, function (data, name) {
    return _install(name, data, opt)
      .addCallback(function () { log("installed" ,name) });
  }).addErrback(fail(p, "Failed to install package set. @TODO: rollback"))
    .addCallback(function () { p.emitSuccess() });

  return p;
};

function _install (name, data, opt) {
  var p = new node.Promise();
  unpack(name, data, opt)
    .addErrback(fail(p, "Failed to unpack "+name))
    .addCallback(function () {
      var steps = [];
      // If it's got a build step, then cd into the folder, and run it.
      // if it's a lib, then write ~/.node_libraries/<package>.js as
      //   exports = require(<package>/<lib.js>)
      // If it's got a start step, then run the start command.

      if (data.lib) steps.push(linkPkgLib);
      if (data.build) steps.push(buildPkg);
      if (data.start) steps.push(startPkg);
      queue(steps, function (fn) { return fn(name, data) })
        .addCallback(method(p, "emitSuccess"))
        .addErrback(method(p, "emitError"));
    });
  return p;
};

function linkPkgLib (name, data) {
  var p = new node.Promise();

  var targetFile = node.path.join(ENV.HOME, ".node_libraries", name+".js");
  log("linking /"+name+".js to /"+name+"/" + data.lib, name);
  
  var relPath = [ENV.HOME, ".node_libraries", name].concat(data.lib.split("/"));
  relPath = node.path.join.apply(node.path, relPath);
  relPath = relPath.replace(/"/g, "\\\"");
  
  node.fs.open(targetFile,
    node.O_CREAT | node.O_TRUNC | node.O_WRONLY,
    0755
  ).addErrback(fail(p, "Couldn't create "+targetFile))
    .addCallback(function (fd) {
      node.fs.write(fd, '__module.exports = require("'+relPath+'");\n')
        .addErrback(fail(p, "Couldn't write code to "+targetFile))
        .addCallback(method(p, "emitSuccess"));
    });
  
  return p;
};
function buildPkg (name, data) {
  log(data.build, name);
  var p = new node.Promise();
  
  // exec("cd "+
  // node.path.join(ENV.HOME, ".node_libraries", name+".js")
  // )
  setTimeout(method(p, "emitSuccess"));
  return p;
};
function startPkg (name, data) {
  log("buildPkg " + data.start, name);
  var p = new node.Promise();
  setTimeout(method(p, "emitSuccess"));
  return p;
};


// unpack to $HOME/.node_libraries/<package>/
function unpack (name, data, opt) {
  var p = new node.Promise();
  log("");
  log(name, "install");
  // fetch the tarball
  var tarball = data.tarball;
  var uri = http.parseUri(tarball);
  var target = node.path.join(ENV.HOME, ".npm", name+".tgz");
  fetch(tarball, target)
    .addErrback(function (m) {
      log("could not fetch "+tarball, "failure");
      if (m) log(m);
      p.emitError();
    })
    .addCallback(function () {
      var targetFolder = node.path.join(ENV.HOME, ".npm", name);
      var finalTarget = node.path.join(ENV.HOME, ".node_libraries", name);
      var staging = targetFolder + "-staging";
      
      // TODO: Break this up.
      queue([
        "rm -rf "+targetFolder,
        "mkdir -p "+staging,
        "cd "+staging + " && tar -xf "+target,
        "cd "+staging + " && mv * "+targetFolder,
        "cd " + targetFolder,
        "rm -rf "+staging,
        "rm -rf " + finalTarget,
        "mv " + targetFolder + " " + finalTarget
      ], function (cmd) {
        return exec("/usr/bin/env bash -c '"+cmd+"'");
      }).addCallback(function (results) {
          log(name, "unpacked");
          p.emitSuccess();
        })
        .addErrback(function (key, item, error) {
          log("step: "+item, "failure");
          log(error[2] || error[0].message, "failure");
          p.emitError();
        });
    });
    
  
  return p;
};

npm.install = function npm_install (pkg, opt) {
  var p = new node.Promise();
  opt = opt || {};
  
  buildInstallSet(pkg)
    .addErrback(fail(p,"Failed building requirements for "+pkg))
    .addCallback(function (set) {
      // log("Install set: "+JSON.stringify(set));
      npm.installPackages(set, opt)
        .addErrback(fail(p, "Failed to install"))
        .addCallback(function () {
          log("success!");
          p.emitSuccess();
        });
    });

  return p;
};

npm.readCatalog = function npm_readCatalog (pkg) {
  
  var p = new node.Promise();
  
  npm.getSources()
    .addErrback(fail(p, "Could not load sources"))
    .addCallback(function (sources) {
      // for each one, swap out the package name, and try to http cat the url.
      for (var i = 0, l = sources.length; i < l; i ++) {
        var source = sources[i];
        var url = source.replace(/\{name\}/gi, pkg);
        log("Fetching package data from "+url);
        try {
          var parsePromise = new node.Promise();
          http.cat(url).addCallback(function (d) {
            try {
              d = JSON.parse(d);
              if (d) parsePromise.emitSuccess(d);
              else parsePromise.emitError(d);
            } catch (ex) {
              parsePromise.emitError(ex);
            }
          });
          var data = parsePromise.wait();
        } catch (ex) {
          continue;
        }
        break;
      }
      if (!data) fail(p, "Could not load data for "+pkg+" from any source.")();
      else (p.emitSuccess(data));
    });
  
  return p;
};

npm.writeCatalog = function npm_writeCatalog () {
  log("writing catalog");
  var p = new node.Promise();
  
  node.fs.open(
    node.path.join(ENV.HOME, ".npm", "catalog.json"),
    node.O_WRONLY | node.O_TRUNC | node.O_CREAT,
    0666
  ).addErrback(fail(p,
    "couldn't open "+node.path.join(ENV.HOME, ".npm", "catalog.json")+" for writing"
  )).addCallback(function (fd) {
    try {
      var data = JSON.stringify(CATALOG);
    } catch (ex) {
      return fail(p, "Couldn't stringify catalog data")();
    }
    node.fs.write(fd, data, 0).addErrback(fail(p,
      "couldn't write to "+node.path.join(ENV.HOME, ".npm", "catalog.json")
    )).addCallback(function () { p.emitSuccess() });
  });
  
  return p;
};

npm.getSources = function npm_getSources () {
  var p = new node.Promise();
  node.fs.cat(node.path.join(ENV.HOME, ".npm", "sources.json"))
    .addErrback(function () {
      p.emitError(new Error(
        "Couldn't read " + node.path.join(ENV.HOME, ".npm", "sources.json") + "\n"
      ));
    })
    .addCallback(function (data) {
      try {
        data = JSON.parse(data);
        if (data) p.emitSuccess(data);
        else p.emitError(data);
      } catch (ex) {
        p.emitError(ex);
      }
    });
  return p;
};

function merge (dest, src) {
  for (var i in src) if (!dest.hasOwnProperty(i)) dest[i] = src[i];
};

function dummyPromise (name) {
  var promise = new node.Promise();
  name = name || arguments.callee.caller.name;
  setTimeout(function () {
    node.stdio.writeError("TODO: implement "+ name + "\n");
    promise.emitSuccess("dummy");
  });
  return promise;
};

function fail (p, msg) { return function () {
  p.emitError();
  log(msg, "failure");
}};
