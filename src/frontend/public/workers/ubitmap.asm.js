var key, read_, readAsync, readBinary, setWindowTitle, nodeFS, nodePath, wasmBinary, wasmMemory, EXITSTATUS, buffer,
  HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64, wasmTable, tempDouble, tempI64,
  _emscripten_get_now, calledRun, Module = void 0 !== Module ? Module : {}, moduleOverrides = {};
for (key in Module) Module.hasOwnProperty(key) && (moduleOverrides[key] = Module[key]);
var arguments_ = [], thisProgram = "./this.program", quit_ = function (e, r) {
  throw r
}, ENVIRONMENT_IS_WEB = !1, ENVIRONMENT_IS_WORKER = !1, ENVIRONMENT_IS_NODE = !1, ENVIRONMENT_IS_SHELL = !1;
ENVIRONMENT_IS_WEB = "object" == typeof window, ENVIRONMENT_IS_WORKER = "function" == typeof importScripts, ENVIRONMENT_IS_NODE = "object" == typeof process && "object" == typeof process.versions && "string" == typeof process.versions.node, ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
var scriptDirectory = "";

function locateFile(e) {
  return Module.locateFile ? Module.locateFile(e, scriptDirectory) : scriptDirectory + e
}

ENVIRONMENT_IS_NODE ? (scriptDirectory = ENVIRONMENT_IS_WORKER ? require("path").dirname(scriptDirectory) + "/" : __dirname + "/", read_ = function e(r, t) {
  return nodeFS || (nodeFS = require("fs")), nodePath || (nodePath = require("path")), r = nodePath.normalize(r), nodeFS.readFileSync(r, t ? null : "utf8")
}, readBinary = function e(r) {
  var t = read_(r, !0);
  return t.buffer || (t = new Uint8Array(t)), assert(t.buffer), t
}, process.argv.length > 1 && (thisProgram = process.argv[1].replace(/\\/g, "/")), arguments_ = process.argv.slice(2), "undefined" != typeof module && (module.exports = Module), process.on("uncaughtException", function (e) {
  if (!(e instanceof ExitStatus)) throw e
}), process.on("unhandledRejection", abort), quit_ = function (e) {
  process.exit(e)
}, Module.inspect = function () {
  return "[Emscripten Module object]"
}) : ENVIRONMENT_IS_SHELL ? ("undefined" != typeof read && (read_ = function e(r) {
  return read(r)
}), readBinary = function e(r) {
  var t;
  return "function" == typeof readbuffer ? new Uint8Array(readbuffer(r)) : (assert("object" == typeof (t = read(r, "binary"))), t)
}, "undefined" != typeof scriptArgs ? arguments_ = scriptArgs : "undefined" != typeof arguments && (arguments_ = arguments), "function" == typeof quit && (quit_ = function (e) {
  quit(e)
}), "undefined" != typeof print && ("undefined" == typeof console && (console = {}), console.log = print, console.warn = console.error = "undefined" != typeof printErr ? printErr : print)) : (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && (ENVIRONMENT_IS_WORKER ? scriptDirectory = self.location.href : "undefined" != typeof document && document.currentScript && (scriptDirectory = document.currentScript.src), scriptDirectory = 0 !== scriptDirectory.indexOf("blob:") ? scriptDirectory.substr(0, scriptDirectory.lastIndexOf("/") + 1) : "", read_ = function (e) {
  var r = new XMLHttpRequest;
  return r.open("GET", e, !1), r.send(null), r.responseText
}, ENVIRONMENT_IS_WORKER && (readBinary = function (e) {
  var r = new XMLHttpRequest;
  return r.open("GET", e, !1), r.responseType = "arraybuffer", r.send(null), new Uint8Array(r.response)
}), readAsync = function (e, r, t) {
  var n = new XMLHttpRequest;
  n.open("GET", e, !0), n.responseType = "arraybuffer", n.onload = function () {
    if (200 == n.status || 0 == n.status && n.response) {
      r(n.response);
      return
    }
    t()
  }, n.onerror = t, n.send(null)
}, setWindowTitle = function (e) {
  document.title = e
});
var out = Module.print || console.log.bind(console), err = Module.printErr || console.warn.bind(console);
for (key in moduleOverrides) moduleOverrides.hasOwnProperty(key) && (Module[key] = moduleOverrides[key]);
moduleOverrides = null, Module.arguments && (arguments_ = Module.arguments), Module.thisProgram && (thisProgram = Module.thisProgram), Module.quit && (quit_ = Module.quit);
var STACK_ALIGN = 16;

function alignMemory(e, r) {
  return r || (r = STACK_ALIGN), Math.ceil(e / r) * r
}

var tempRet0 = 0, setTempRet0 = function (e) {
  tempRet0 = e
};
Module.wasmBinary && (wasmBinary = Module.wasmBinary);
var noExitRuntime = Module.noExitRuntime || !0;
"object" != typeof WebAssembly && abort("no native wasm support detected");
var ABORT = !1;

function assert(e, r) {
  e || abort("Assertion failed: " + r)
}

var UTF8Decoder = "undefined" != typeof TextDecoder ? new TextDecoder("utf8") : void 0;

function UTF8ArrayToString(e, r, t) {
  for (var n = r + t, o = r; e[o] && !(o >= n);) ++o;
  if (o - r > 16 && e.subarray && UTF8Decoder) return UTF8Decoder.decode(e.subarray(r, o));
  for (var i = ""; r < o;) {
    var a = e[r++];
    if (!(128 & a)) {
      i += String.fromCharCode(a);
      continue
    }
    var s = 63 & e[r++];
    if ((224 & a) == 192) {
      i += String.fromCharCode((31 & a) << 6 | s);
      continue
    }
    var u = 63 & e[r++];
    if ((a = (240 & a) == 224 ? (15 & a) << 12 | s << 6 | u : (7 & a) << 18 | s << 12 | u << 6 | 63 & e[r++]) < 65536) i += String.fromCharCode(a); else {
      var l = a - 65536;
      i += String.fromCharCode(55296 | l >> 10, 56320 | 1023 & l)
    }
  }
  return i
}

function UTF8ToString(e, r) {
  return e ? UTF8ArrayToString(HEAPU8, e, r) : ""
}

function stringToUTF8Array(e, r, t, n) {
  if (!(n > 0)) return 0;
  for (var o = t, i = t + n - 1, a = 0; a < e.length; ++a) {
    var s = e.charCodeAt(a);
    if (s >= 55296 && s <= 57343 && (s = 65536 + ((1023 & s) << 10) | 1023 & e.charCodeAt(++a)), s <= 127) {
      if (t >= i) break;
      r[t++] = s
    } else if (s <= 2047) {
      if (t + 1 >= i) break;
      r[t++] = 192 | s >> 6, r[t++] = 128 | 63 & s
    } else if (s <= 65535) {
      if (t + 2 >= i) break;
      r[t++] = 224 | s >> 12, r[t++] = 128 | s >> 6 & 63, r[t++] = 128 | 63 & s
    } else {
      if (t + 3 >= i) break;
      r[t++] = 240 | s >> 18, r[t++] = 128 | s >> 12 & 63, r[t++] = 128 | s >> 6 & 63, r[t++] = 128 | 63 & s
    }
  }
  return r[t] = 0, t - o
}

function stringToUTF8(e, r, t) {
  return stringToUTF8Array(e, HEAPU8, r, t)
}

function lengthBytesUTF8(e) {
  for (var r = 0, t = 0; t < e.length; ++t) {
    var n = e.charCodeAt(t);
    n >= 55296 && n <= 57343 && (n = 65536 + ((1023 & n) << 10) | 1023 & e.charCodeAt(++t)), n <= 127 ? ++r : n <= 2047 ? r += 2 : n <= 65535 ? r += 3 : r += 4
  }
  return r
}

var UTF16Decoder = "undefined" != typeof TextDecoder ? new TextDecoder("utf-16le") : void 0;

function UTF16ToString(e, r) {
  for (var t = e, n = t >> 1, o = n + r / 2; !(n >= o) && HEAPU16[n];) ++n;
  if ((t = n << 1) - e > 32 && UTF16Decoder) return UTF16Decoder.decode(HEAPU8.subarray(e, t));
  for (var i = "", a = 0; !(a >= r / 2); ++a) {
    var s = HEAP16[e + 2 * a >> 1];
    if (0 == s) break;
    i += String.fromCharCode(s)
  }
  return i
}

function stringToUTF16(e, r, t) {
  if (void 0 === t && (t = 2147483647), t < 2) return 0;
  for (var n = r, o = (t -= 2) < 2 * e.length ? t / 2 : e.length, i = 0; i < o; ++i) {
    var a = e.charCodeAt(i);
    HEAP16[r >> 1] = a, r += 2
  }
  return HEAP16[r >> 1] = 0, r - n
}

function lengthBytesUTF16(e) {
  return 2 * e.length
}

function UTF32ToString(e, r) {
  for (var t = 0, n = ""; !(t >= r / 4);) {
    var o = HEAP32[e + 4 * t >> 2];
    if (0 == o) break;
    if (++t, o >= 65536) {
      var i = o - 65536;
      n += String.fromCharCode(55296 | i >> 10, 56320 | 1023 & i)
    } else n += String.fromCharCode(o)
  }
  return n
}

function stringToUTF32(e, r, t) {
  if (void 0 === t && (t = 2147483647), t < 4) return 0;
  for (var n = r, o = n + t - 4, i = 0; i < e.length; ++i) {
    var a = e.charCodeAt(i);
    if (a >= 55296 && a <= 57343 && (a = 65536 + ((1023 & a) << 10) | 1023 & e.charCodeAt(++i)), HEAP32[r >> 2] = a, (r += 4) + 4 > o) break
  }
  return HEAP32[r >> 2] = 0, r - n
}

function lengthBytesUTF32(e) {
  for (var r = 0, t = 0; t < e.length; ++t) {
    var n = e.charCodeAt(t);
    n >= 55296 && n <= 57343 && ++t, r += 4
  }
  return r
}

function allocateUTF8(e) {
  var r = lengthBytesUTF8(e) + 1, t = _malloc(r);
  return t && stringToUTF8Array(e, HEAP8, t, r), t
}

function alignUp(e, r) {
  return e % r > 0 && (e += r - e % r), e
}

function updateGlobalBufferAndViews(e) {
  buffer = e, Module.HEAP8 = HEAP8 = new Int8Array(e), Module.HEAP16 = HEAP16 = new Int16Array(e), Module.HEAP32 = HEAP32 = new Int32Array(e), Module.HEAPU8 = HEAPU8 = new Uint8Array(e), Module.HEAPU16 = HEAPU16 = new Uint16Array(e), Module.HEAPU32 = HEAPU32 = new Uint32Array(e), Module.HEAPF32 = HEAPF32 = new Float32Array(e), Module.HEAPF64 = HEAPF64 = new Float64Array(e)
}

var INITIAL_MEMORY = Module.INITIAL_MEMORY || 16777216, __ATPRERUN__ = [], __ATINIT__ = [], __ATMAIN__ = [],
  __ATPOSTRUN__ = [], runtimeInitialized = !1;

function preRun() {
  if (Module.preRun) for ("function" == typeof Module.preRun && (Module.preRun = [Module.preRun]); Module.preRun.length;) addOnPreRun(Module.preRun.shift());
  callRuntimeCallbacks(__ATPRERUN__)
}

function initRuntime() {
  runtimeInitialized = !0, Module.noFSInit || FS.init.initialized || FS.init(), TTY.init(), callRuntimeCallbacks(__ATINIT__)
}

function preMain() {
  FS.ignorePermissions = !1, callRuntimeCallbacks(__ATMAIN__)
}

function postRun() {
  if (Module.postRun) for ("function" == typeof Module.postRun && (Module.postRun = [Module.postRun]); Module.postRun.length;) addOnPostRun(Module.postRun.shift());
  callRuntimeCallbacks(__ATPOSTRUN__)
}

function addOnPreRun(e) {
  __ATPRERUN__.unshift(e)
}

function addOnPostRun(e) {
  __ATPOSTRUN__.unshift(e)
}

__ATINIT__.push({
  func: function () {
    ___wasm_call_ctors()
  }
});
var runDependencies = 0, runDependencyWatcher = null, dependenciesFulfilled = null;

function getUniqueRunDependency(e) {
  return e
}

function addRunDependency(e) {
  runDependencies++, Module.monitorRunDependencies && Module.monitorRunDependencies(runDependencies)
}

function removeRunDependency(e) {
  if (runDependencies--, Module.monitorRunDependencies && Module.monitorRunDependencies(runDependencies), 0 == runDependencies && (null !== runDependencyWatcher && (clearInterval(runDependencyWatcher), runDependencyWatcher = null), dependenciesFulfilled)) {
    var r = dependenciesFulfilled;
    dependenciesFulfilled = null, r()
  }
}

function abort(e) {
  throw Module.onAbort && Module.onAbort(e), err(e += ""), ABORT = !0, EXITSTATUS = 1, e = "abort(" + e + "). Build with -s ASSERTIONS=1 for more info.", new WebAssembly.RuntimeError(e)
}

function hasPrefix(e, r) {
  return String.prototype.startsWith ? e.startsWith(r) : 0 === e.indexOf(r)
}

Module.preloadedImages = {}, Module.preloadedAudios = {};
var dataURIPrefix = "data:application/octet-stream;base64,";

function isDataURI(e) {
  return hasPrefix(e, dataURIPrefix)
}

var fileURIPrefix = "file://";

function isFileURI(e) {
  return hasPrefix(e, fileURIPrefix)
}

//var wasmBinaryFile = self.wasmBinaryFile;

function getBinary(e) {
  try {
    if (e == wasmBinaryFile && wasmBinary) return new Uint8Array(wasmBinary);
    if (readBinary) return readBinary(e);
    throw"both async and sync fetching of the wasm failed"
  } catch (r) {
    abort(r)
  }
}

function getBinaryPromise() {
  if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER)) {
    if ("function" == typeof fetch && !isFileURI(wasmBinaryFile)) return fetch(wasmBinaryFile, {credentials: "same-origin"}).then(function (e) {
      if (!e.ok) throw"failed to load wasm binary file at '" + wasmBinaryFile + "'";
      return e.arrayBuffer()
    }).catch(function () {
      return getBinary(wasmBinaryFile)
    });
    if (readAsync) return new Promise(function (e, r) {
      readAsync(wasmBinaryFile, function (r) {
        e(new Uint8Array(r))
      }, r)
    })
  }
  return Promise.resolve().then(function () {
    return getBinary(wasmBinaryFile)
  })
}

function createWasm() {
  var e = {a: asmLibraryArg};

  function r(e, r) {
    var t = e.exports;
    Module.asm = t, updateGlobalBufferAndViews((wasmMemory = Module.asm.L).buffer), wasmTable = Module.asm.O, removeRunDependency("wasm-instantiate")
  }

  function t(e) {
    r(e.instance)
  }

  function n(r) {
    return getBinaryPromise().then(function (r) {
      return WebAssembly.instantiate(r, e)
    }).then(r, function (e) {
      err("failed to asynchronously prepare wasm: " + e), abort(e)
    })
  }

  if (addRunDependency("wasm-instantiate"), Module.instantiateWasm) try {
    return Module.instantiateWasm(e, r)
  } catch (o) {
    return err("Module.instantiateWasm callback failed with error: " + o), !1
  }
  return wasmBinary || "function" != typeof WebAssembly.instantiateStreaming || isDataURI(wasmBinaryFile) || isFileURI(wasmBinaryFile) || "function" != typeof fetch ? n(t) : fetch(wasmBinaryFile, {credentials: "same-origin"}).then(function (r) {
    return WebAssembly.instantiateStreaming(r, e).then(t, function (e) {
      return err("wasm streaming compile failed: " + e), err("falling back to ArrayBuffer instantiation"), n(t)
    })
  }), {}
}

function callRuntimeCallbacks(e) {
  for (; e.length > 0;) {
    var r = e.shift();
    if ("function" == typeof r) {
      r(Module);
      continue
    }
    var t = r.func;
    "number" == typeof t ? void 0 === r.arg ? wasmTable.get(t)() : wasmTable.get(t)(r.arg) : t(void 0 === r.arg ? null : r.arg)
  }
}

isDataURI(wasmBinaryFile) || (wasmBinaryFile = locateFile(wasmBinaryFile));
var ExceptionInfoAttrs = {
  DESTRUCTOR_OFFSET: 0,
  REFCOUNT_OFFSET: 4,
  TYPE_OFFSET: 8,
  CAUGHT_OFFSET: 12,
  RETHROWN_OFFSET: 13,
  SIZE: 16
};

function ___cxa_allocate_exception(e) {
  return _malloc(e + ExceptionInfoAttrs.SIZE) + ExceptionInfoAttrs.SIZE
}

var exceptionCaught = [], exceptionLast = 0, uncaughtExceptionCount = 0;

function ___cxa_rethrow() {
  var e = exceptionCaught.pop();
  e || abort("no exception to throw");
  var r = e.get_exception_info(), t = e.get_base_ptr();
  throw r.get_rethrown() ? e.free() : (exceptionCaught.push(e), r.set_rethrown(!0), r.set_caught(!1), uncaughtExceptionCount++), exceptionLast = t, t
}

function ExceptionInfo(e) {
  this.excPtr = e, this.ptr = e - ExceptionInfoAttrs.SIZE, this.set_type = function (e) {
    HEAP32[this.ptr + ExceptionInfoAttrs.TYPE_OFFSET >> 2] = e
  }, this.get_type = function () {
    return HEAP32[this.ptr + ExceptionInfoAttrs.TYPE_OFFSET >> 2]
  }, this.set_destructor = function (e) {
    HEAP32[this.ptr + ExceptionInfoAttrs.DESTRUCTOR_OFFSET >> 2] = e
  }, this.get_destructor = function () {
    return HEAP32[this.ptr + ExceptionInfoAttrs.DESTRUCTOR_OFFSET >> 2]
  }, this.set_refcount = function (e) {
    HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2] = e
  }, this.set_caught = function (e) {
    e = e ? 1 : 0, HEAP8[this.ptr + ExceptionInfoAttrs.CAUGHT_OFFSET >> 0] = e
  }, this.get_caught = function () {
    return 0 != HEAP8[this.ptr + ExceptionInfoAttrs.CAUGHT_OFFSET >> 0]
  }, this.set_rethrown = function (e) {
    e = e ? 1 : 0, HEAP8[this.ptr + ExceptionInfoAttrs.RETHROWN_OFFSET >> 0] = e
  }, this.get_rethrown = function () {
    return 0 != HEAP8[this.ptr + ExceptionInfoAttrs.RETHROWN_OFFSET >> 0]
  }, this.init = function (e, r) {
    this.set_type(e), this.set_destructor(r), this.set_refcount(0), this.set_caught(!1), this.set_rethrown(!1)
  }, this.add_ref = function () {
    var e = HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2];
    HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2] = e + 1
  }, this.release_ref = function () {
    var e = HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2];
    return HEAP32[this.ptr + ExceptionInfoAttrs.REFCOUNT_OFFSET >> 2] = e - 1, 1 === e
  }
}

function ___cxa_throw(e, r, t) {
  throw new ExceptionInfo(e).init(r, t), exceptionLast = e, uncaughtExceptionCount++, e
}

function setErrNo(e) {
  return HEAP32[___errno_location() >> 2] = e, e
}

var PATH = {
  splitPath: function (e) {
    return /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(e).slice(1)
  }, normalizeArray: function (e, r) {
    for (var t = 0, n = e.length - 1; n >= 0; n--) {
      var o = e[n];
      "." === o ? e.splice(n, 1) : ".." === o ? (e.splice(n, 1), t++) : t && (e.splice(n, 1), t--)
    }
    if (r) for (; t; t--) e.unshift("..");
    return e
  }, normalize: function (e) {
    var r = "/" === e.charAt(0), t = "/" === e.substr(-1);
    return (e = PATH.normalizeArray(e.split("/").filter(function (e) {
      return !!e
    }), !r).join("/")) || r || (e = "."), e && t && (e += "/"), (r ? "/" : "") + e
  }, dirname: function (e) {
    var r = PATH.splitPath(e), t = r[0], n = r[1];
    return t || n ? (n && (n = n.substr(0, n.length - 1)), t + n) : "."
  }, basename: function (e) {
    if ("/" === e) return "/";
    var r = (e = (e = PATH.normalize(e)).replace(/\/$/, "")).lastIndexOf("/");
    return -1 === r ? e : e.substr(r + 1)
  }, extname: function (e) {
    return PATH.splitPath(e)[3]
  }, join: function () {
    var e = Array.prototype.slice.call(arguments, 0);
    return PATH.normalize(e.join("/"))
  }, join2: function (e, r) {
    return PATH.normalize(e + "/" + r)
  }
};

function getRandomDevice() {
  if ("object" == typeof crypto && "function" == typeof crypto.getRandomValues) {
    var e = new Uint8Array(1);
    return function () {
      return crypto.getRandomValues(e), e[0]
    }
  }
  if (ENVIRONMENT_IS_NODE) try {
    var r = require("crypto");
    return function () {
      return r.randomBytes(1)[0]
    }
  } catch (t) {
  }
  return function () {
    abort("randomDevice")
  }
}

var PATH_FS = {
  resolve: function () {
    for (var e = "", r = !1, t = arguments.length - 1; t >= -1 && !r; t--) {
      var n = t >= 0 ? arguments[t] : FS.cwd();
      if ("string" != typeof n) throw TypeError("Arguments to path.resolve must be strings");
      if (!n) return "";
      e = n + "/" + e, r = "/" === n.charAt(0)
    }
    return e = PATH.normalizeArray(e.split("/").filter(function (e) {
      return !!e
    }), !r).join("/"), (r ? "/" : "") + e || "."
  }, relative: function (e, r) {
    function t(e) {
      for (var r = 0; r < e.length && "" === e[r]; r++) ;
      for (var t = e.length - 1; t >= 0 && "" === e[t]; t--) ;
      return r > t ? [] : e.slice(r, t - r + 1)
    }

    e = PATH_FS.resolve(e).substr(1), r = PATH_FS.resolve(r).substr(1);
    for (var n = t(e.split("/")), o = t(r.split("/")), i = Math.min(n.length, o.length), a = i, s = 0; s < i; s++) if (n[s] !== o[s]) {
      a = s;
      break
    }
    for (var u = [], s = a; s < n.length; s++) u.push("..");
    return (u = u.concat(o.slice(a))).join("/")
  }
}, TTY = {
  ttys: [], init: function () {
  }, shutdown: function () {
  }, register: function (e, r) {
    TTY.ttys[e] = {input: [], output: [], ops: r}, FS.registerDevice(e, TTY.stream_ops)
  }, stream_ops: {
    open: function (e) {
      var r = TTY.ttys[e.node.rdev];
      if (!r) throw new FS.ErrnoError(43);
      e.tty = r, e.seekable = !1
    }, close: function (e) {
      e.tty.ops.flush(e.tty)
    }, flush: function (e) {
      e.tty.ops.flush(e.tty)
    }, read: function (e, r, t, n, o) {
      if (!e.tty || !e.tty.ops.get_char) throw new FS.ErrnoError(60);
      for (var i, a = 0, s = 0; s < n; s++) {
        try {
          i = e.tty.ops.get_char(e.tty)
        } catch (u) {
          throw new FS.ErrnoError(29)
        }
        if (void 0 === i && 0 === a) throw new FS.ErrnoError(6);
        if (null == i) break;
        a++, r[t + s] = i
      }
      return a && (e.node.timestamp = Date.now()), a
    }, write: function (e, r, t, n, o) {
      if (!e.tty || !e.tty.ops.put_char) throw new FS.ErrnoError(60);
      try {
        for (var i = 0; i < n; i++) e.tty.ops.put_char(e.tty, r[t + i])
      } catch (a) {
        throw new FS.ErrnoError(29)
      }
      return n && (e.node.timestamp = Date.now()), i
    }
  }, default_tty_ops: {
    get_char: function (e) {
      if (!e.input.length) {
        var r = null;
        if (ENVIRONMENT_IS_NODE) {
          var t = Buffer.alloc ? Buffer.alloc(256) : new Buffer(256), n = 0;
          try {
            n = nodeFS.readSync(process.stdin.fd, t, 0, 256, null)
          } catch (o) {
            if (-1 != o.toString().indexOf("EOF")) n = 0; else throw o
          }
          r = n > 0 ? t.slice(0, n).toString("utf-8") : null
        } else "undefined" != typeof window && "function" == typeof window.prompt ? null !== (r = window.prompt("Input: ")) && (r += "\n") : "function" == typeof readline && null !== (r = readline()) && (r += "\n");
        if (!r) return null;
        e.input = intArrayFromString(r, !0)
      }
      return e.input.shift()
    }, put_char: function (e, r) {
      null === r || 10 === r ? (out(UTF8ArrayToString(e.output, 0)), e.output = []) : 0 != r && e.output.push(r)
    }, flush: function (e) {
      e.output && e.output.length > 0 && (out(UTF8ArrayToString(e.output, 0)), e.output = [])
    }
  }, default_tty1_ops: {
    put_char: function (e, r) {
      null === r || 10 === r ? (err(UTF8ArrayToString(e.output, 0)), e.output = []) : 0 != r && e.output.push(r)
    }, flush: function (e) {
      e.output && e.output.length > 0 && (err(UTF8ArrayToString(e.output, 0)), e.output = [])
    }
  }
};

function mmapAlloc(e) {
  for (var r = alignMemory(e, 16384), t = _malloc(r); e < r;) HEAP8[t + e++] = 0;
  return t
}

var MEMFS = {
  ops_table: null, mount: function (e) {
    return MEMFS.createNode(null, "/", 16895, 0)
  }, createNode: function (e, r, t, n) {
    if (FS.isBlkdev(t) || FS.isFIFO(t)) throw new FS.ErrnoError(63);
    MEMFS.ops_table || (MEMFS.ops_table = {
      dir: {
        node: {
          getattr: MEMFS.node_ops.getattr,
          setattr: MEMFS.node_ops.setattr,
          lookup: MEMFS.node_ops.lookup,
          mknod: MEMFS.node_ops.mknod,
          rename: MEMFS.node_ops.rename,
          unlink: MEMFS.node_ops.unlink,
          rmdir: MEMFS.node_ops.rmdir,
          readdir: MEMFS.node_ops.readdir,
          symlink: MEMFS.node_ops.symlink
        }, stream: {llseek: MEMFS.stream_ops.llseek}
      },
      file: {
        node: {getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr},
        stream: {
          llseek: MEMFS.stream_ops.llseek,
          read: MEMFS.stream_ops.read,
          write: MEMFS.stream_ops.write,
          allocate: MEMFS.stream_ops.allocate,
          mmap: MEMFS.stream_ops.mmap,
          msync: MEMFS.stream_ops.msync
        }
      },
      link: {
        node: {
          getattr: MEMFS.node_ops.getattr,
          setattr: MEMFS.node_ops.setattr,
          readlink: MEMFS.node_ops.readlink
        }, stream: {}
      },
      chrdev: {node: {getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr}, stream: FS.chrdev_stream_ops}
    });
    var o = FS.createNode(e, r, t, n);
    return FS.isDir(o.mode) ? (o.node_ops = MEMFS.ops_table.dir.node, o.stream_ops = MEMFS.ops_table.dir.stream, o.contents = {}) : FS.isFile(o.mode) ? (o.node_ops = MEMFS.ops_table.file.node, o.stream_ops = MEMFS.ops_table.file.stream, o.usedBytes = 0, o.contents = null) : FS.isLink(o.mode) ? (o.node_ops = MEMFS.ops_table.link.node, o.stream_ops = MEMFS.ops_table.link.stream) : FS.isChrdev(o.mode) && (o.node_ops = MEMFS.ops_table.chrdev.node, o.stream_ops = MEMFS.ops_table.chrdev.stream), o.timestamp = Date.now(), e && (e.contents[r] = o, e.timestamp = o.timestamp), o
  }, getFileDataAsTypedArray: function (e) {
    return e.contents ? e.contents.subarray ? e.contents.subarray(0, e.usedBytes) : new Uint8Array(e.contents) : new Uint8Array(0)
  }, expandFileStorage: function (e, r) {
    var t = e.contents ? e.contents.length : 0;
    if (!(t >= r)) {
      r = Math.max(r, t * (t < 1048576 ? 2 : 1.125) >>> 0), 0 != t && (r = Math.max(r, 256));
      var n = e.contents;
      e.contents = new Uint8Array(r), e.usedBytes > 0 && e.contents.set(n.subarray(0, e.usedBytes), 0)
    }
  }, resizeFileStorage: function (e, r) {
    if (e.usedBytes != r) {
      if (0 == r) e.contents = null, e.usedBytes = 0; else {
        var t = e.contents;
        e.contents = new Uint8Array(r), t && e.contents.set(t.subarray(0, Math.min(r, e.usedBytes))), e.usedBytes = r
      }
    }
  }, node_ops: {
    getattr: function (e) {
      var r = {};
      return r.dev = FS.isChrdev(e.mode) ? e.id : 1, r.ino = e.id, r.mode = e.mode, r.nlink = 1, r.uid = 0, r.gid = 0, r.rdev = e.rdev, FS.isDir(e.mode) ? r.size = 4096 : FS.isFile(e.mode) ? r.size = e.usedBytes : FS.isLink(e.mode) ? r.size = e.link.length : r.size = 0, r.atime = new Date(e.timestamp), r.mtime = new Date(e.timestamp), r.ctime = new Date(e.timestamp), r.blksize = 4096, r.blocks = Math.ceil(r.size / r.blksize), r
    }, setattr: function (e, r) {
      void 0 !== r.mode && (e.mode = r.mode), void 0 !== r.timestamp && (e.timestamp = r.timestamp), void 0 !== r.size && MEMFS.resizeFileStorage(e, r.size)
    }, lookup: function (e, r) {
      throw FS.genericErrors[44]
    }, mknod: function (e, r, t, n) {
      return MEMFS.createNode(e, r, t, n)
    }, rename: function (e, r, t) {
      if (FS.isDir(e.mode)) {
        var n;
        try {
          n = FS.lookupNode(r, t)
        } catch (o) {
        }
        if (n) for (var i in n.contents) throw new FS.ErrnoError(55)
      }
      delete e.parent.contents[e.name], e.parent.timestamp = Date.now(), e.name = t, r.contents[t] = e, r.timestamp = e.parent.timestamp, e.parent = r
    }, unlink: function (e, r) {
      delete e.contents[r], e.timestamp = Date.now()
    }, rmdir: function (e, r) {
      var t = FS.lookupNode(e, r);
      for (var n in t.contents) throw new FS.ErrnoError(55);
      delete e.contents[r], e.timestamp = Date.now()
    }, readdir: function (e) {
      var r = [".", ".."];
      for (var t in e.contents) e.contents.hasOwnProperty(t) && r.push(t);
      return r
    }, symlink: function (e, r, t) {
      var n = MEMFS.createNode(e, r, 41471, 0);
      return n.link = t, n
    }, readlink: function (e) {
      if (!FS.isLink(e.mode)) throw new FS.ErrnoError(28);
      return e.link
    }
  }, stream_ops: {
    read: function (e, r, t, n, o) {
      var i = e.node.contents;
      if (o >= e.node.usedBytes) return 0;
      var a = Math.min(e.node.usedBytes - o, n);
      if (a > 8 && i.subarray) r.set(i.subarray(o, o + a), t); else for (var s = 0; s < a; s++) r[t + s] = i[o + s];
      return a
    }, write: function (e, r, t, n, o, i) {
      if (r.buffer === HEAP8.buffer && (i = !1), !n) return 0;
      var a = e.node;
      if (a.timestamp = Date.now(), r.subarray && (!a.contents || a.contents.subarray)) {
        if (i) return a.contents = r.subarray(t, t + n), a.usedBytes = n, n;
        if (0 === a.usedBytes && 0 === o) return a.contents = r.slice(t, t + n), a.usedBytes = n, n;
        if (o + n <= a.usedBytes) return a.contents.set(r.subarray(t, t + n), o), n
      }
      if (MEMFS.expandFileStorage(a, o + n), a.contents.subarray && r.subarray) a.contents.set(r.subarray(t, t + n), o); else for (var s = 0; s < n; s++) a.contents[o + s] = r[t + s];
      return a.usedBytes = Math.max(a.usedBytes, o + n), n
    }, llseek: function (e, r, t) {
      var n = r;
      if (1 === t ? n += e.position : 2 === t && FS.isFile(e.node.mode) && (n += e.node.usedBytes), n < 0) throw new FS.ErrnoError(28);
      return n
    }, allocate: function (e, r, t) {
      MEMFS.expandFileStorage(e.node, r + t), e.node.usedBytes = Math.max(e.node.usedBytes, r + t)
    }, mmap: function (e, r, t, n, o, i) {
      if (0 !== r) throw new FS.ErrnoError(28);
      if (!FS.isFile(e.node.mode)) throw new FS.ErrnoError(43);
      var a, s, u = e.node.contents;
      if (2 & i || u.buffer !== buffer) {
        if ((n > 0 || n + t < u.length) && (u = u.subarray ? u.subarray(n, n + t) : Array.prototype.slice.call(u, n, n + t)), s = !0, !(a = mmapAlloc(t))) throw new FS.ErrnoError(48);
        HEAP8.set(u, a)
      } else s = !1, a = u.byteOffset;
      return {ptr: a, allocated: s}
    }, msync: function (e, r, t, n, o) {
      if (!FS.isFile(e.node.mode)) throw new FS.ErrnoError(43);
      return 2 & o || MEMFS.stream_ops.write(e, r, 0, n, t, !1), 0
    }
  }
}, WORKERFS = {
  DIR_MODE: 16895, FILE_MODE: 33279, reader: null, mount: function (e) {
    assert(ENVIRONMENT_IS_WORKER), WORKERFS.reader || (WORKERFS.reader = new FileReaderSync);
    var r = WORKERFS.createNode(null, "/", WORKERFS.DIR_MODE, 0), t = {};

    function n(e) {
      for (var n = e.split("/"), o = r, i = 0; i < n.length - 1; i++) {
        var a = n.slice(0, i + 1).join("/");
        t[a] || (t[a] = WORKERFS.createNode(o, n[i], WORKERFS.DIR_MODE, 0)), o = t[a]
      }
      return o
    }

    function o(e) {
      var r = e.split("/");
      return r[r.length - 1]
    }

    return Array.prototype.forEach.call(e.opts.files || [], function (e) {
      WORKERFS.createNode(n(e.name), o(e.name), WORKERFS.FILE_MODE, 0, e, e.lastModifiedDate)
    }), (e.opts.blobs || []).forEach(function (e) {
      WORKERFS.createNode(n(e.name), o(e.name), WORKERFS.FILE_MODE, 0, e.data)
    }), (e.opts.packages || []).forEach(function (e) {
      e.metadata.files.forEach(function (r) {
        var t = r.filename.substr(1);
        WORKERFS.createNode(n(t), o(t), WORKERFS.FILE_MODE, 0, e.blob.slice(r.start, r.end))
      })
    }), r
  }, createNode: function (e, r, t, n, o, i) {
    var a = FS.createNode(e, r, t);
    return a.mode = t, a.node_ops = WORKERFS.node_ops, a.stream_ops = WORKERFS.stream_ops, a.timestamp = (i || new Date).getTime(), assert(WORKERFS.FILE_MODE !== WORKERFS.DIR_MODE), t === WORKERFS.FILE_MODE ? (a.size = o.size, a.contents = o) : (a.size = 4096, a.contents = {}), e && (e.contents[r] = a), a
  }, node_ops: {
    getattr: function (e) {
      return {
        dev: 1,
        ino: e.id,
        mode: e.mode,
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: void 0,
        size: e.size,
        atime: new Date(e.timestamp),
        mtime: new Date(e.timestamp),
        ctime: new Date(e.timestamp),
        blksize: 4096,
        blocks: Math.ceil(e.size / 4096)
      }
    }, setattr: function (e, r) {
      void 0 !== r.mode && (e.mode = r.mode), void 0 !== r.timestamp && (e.timestamp = r.timestamp)
    }, lookup: function (e, r) {
      throw new FS.ErrnoError(44)
    }, mknod: function (e, r, t, n) {
      throw new FS.ErrnoError(63)
    }, rename: function (e, r, t) {
      throw new FS.ErrnoError(63)
    }, unlink: function (e, r) {
      throw new FS.ErrnoError(63)
    }, rmdir: function (e, r) {
      throw new FS.ErrnoError(63)
    }, readdir: function (e) {
      var r = [".", ".."];
      for (var t in e.contents) e.contents.hasOwnProperty(t) && r.push(t);
      return r
    }, symlink: function (e, r, t) {
      throw new FS.ErrnoError(63)
    }, readlink: function (e) {
      throw new FS.ErrnoError(63)
    }
  }, stream_ops: {
    read: function (e, r, t, n, o) {
      if (o >= e.node.size) return 0;
      var i = e.node.contents.slice(o, o + n), a = WORKERFS.reader.readAsArrayBuffer(i);
      return r.set(new Uint8Array(a), t), i.size
    }, write: function (e, r, t, n, o) {
      throw new FS.ErrnoError(29)
    }, llseek: function (e, r, t) {
      var n = r;
      if (1 === t ? n += e.position : 2 === t && FS.isFile(e.node.mode) && (n += e.node.size), n < 0) throw new FS.ErrnoError(28);
      return n
    }
  }
}, FS = {
  root: null,
  mounts: [],
  devices: {},
  streams: [],
  nextInode: 1,
  nameTable: null,
  currentPath: "/",
  initialized: !1,
  ignorePermissions: !0,
  trackingDelegate: {},
  tracking: {openFlags: {READ: 1, WRITE: 2}},
  ErrnoError: null,
  genericErrors: {},
  filesystems: null,
  syncFSRequests: 0,
  lookupPath: function (e, r) {
    if (e = PATH_FS.resolve(FS.cwd(), e), r = r || {}, !e) return {path: "", node: null};
    var t = {follow_mount: !0, recurse_count: 0};
    for (var n in t) void 0 === r[n] && (r[n] = t[n]);
    if (r.recurse_count > 8) throw new FS.ErrnoError(32);
    for (var o = PATH.normalizeArray(e.split("/").filter(function (e) {
      return !!e
    }), !1), i = FS.root, a = "/", s = 0; s < o.length; s++) {
      var u = s === o.length - 1;
      if (u && r.parent) break;
      if (i = FS.lookupNode(i, o[s]), a = PATH.join2(a, o[s]), FS.isMountpoint(i) && (!u || u && r.follow_mount) && (i = i.mounted.root), !u || r.follow) for (var l = 0; FS.isLink(i.mode);) {
        var c = FS.readlink(a);
        if (a = PATH_FS.resolve(PATH.dirname(a), c), i = FS.lookupPath(a, {recurse_count: r.recurse_count}).node, l++ > 40) throw new FS.ErrnoError(32)
      }
    }
    return {path: a, node: i}
  },
  getPath: function (e) {
    for (var r; ;) {
      if (FS.isRoot(e)) {
        var t = e.mount.mountpoint;
        if (!r) return t;
        return "/" !== t[t.length - 1] ? t + "/" + r : t + r
      }
      r = r ? e.name + "/" + r : e.name, e = e.parent
    }
  },
  hashName: function (e, r) {
    for (var t = 0, n = 0; n < r.length; n++) t = (t << 5) - t + r.charCodeAt(n) | 0;
    return (e + t >>> 0) % FS.nameTable.length
  },
  hashAddNode: function (e) {
    var r = FS.hashName(e.parent.id, e.name);
    e.name_next = FS.nameTable[r], FS.nameTable[r] = e
  },
  hashRemoveNode: function (e) {
    var r = FS.hashName(e.parent.id, e.name);
    if (FS.nameTable[r] === e) FS.nameTable[r] = e.name_next; else for (var t = FS.nameTable[r]; t;) {
      if (t.name_next === e) {
        t.name_next = e.name_next;
        break
      }
      t = t.name_next
    }
  },
  lookupNode: function (e, r) {
    var t = FS.mayLookup(e);
    if (t) throw new FS.ErrnoError(t, e);
    for (var n = FS.hashName(e.id, r), o = FS.nameTable[n]; o; o = o.name_next) {
      var i = o.name;
      if (o.parent.id === e.id && i === r) return o
    }
    return FS.lookup(e, r)
  },
  createNode: function (e, r, t, n) {
    var o = new FS.FSNode(e, r, t, n);
    return FS.hashAddNode(o), o
  },
  destroyNode: function (e) {
    FS.hashRemoveNode(e)
  },
  isRoot: function (e) {
    return e === e.parent
  },
  isMountpoint: function (e) {
    return !!e.mounted
  },
  isFile: function (e) {
    return (61440 & e) == 32768
  },
  isDir: function (e) {
    return (61440 & e) == 16384
  },
  isLink: function (e) {
    return (61440 & e) == 40960
  },
  isChrdev: function (e) {
    return (61440 & e) == 8192
  },
  isBlkdev: function (e) {
    return (61440 & e) == 24576
  },
  isFIFO: function (e) {
    return (61440 & e) == 4096
  },
  isSocket: function (e) {
    return (49152 & e) == 49152
  },
  flagModes: {r: 0, "r+": 2, w: 577, "w+": 578, a: 1089, "a+": 1090},
  modeStringToFlags: function (e) {
    var r = FS.flagModes[e];
    if (void 0 === r) throw Error("Unknown file open mode: " + e);
    return r
  },
  flagsToPermissionString: function (e) {
    var r = ["r", "w", "rw"][3 & e];
    return 512 & e && (r += "w"), r
  },
  nodePermissions: function (e, r) {
    return FS.ignorePermissions ? 0 : (-1 === r.indexOf("r") || 292 & e.mode) && (-1 === r.indexOf("w") || 146 & e.mode) && (-1 === r.indexOf("x") || 73 & e.mode) ? 0 : 2
  },
  mayLookup: function (e) {
    var r = FS.nodePermissions(e, "x");
    return r || (e.node_ops.lookup ? 0 : 2)
  },
  mayCreate: function (e, r) {
    try {
      return FS.lookupNode(e, r), 20
    } catch (t) {
    }
    return FS.nodePermissions(e, "wx")
  },
  mayDelete: function (e, r, t) {
    try {
      o = FS.lookupNode(e, r)
    } catch (n) {
      return n.errno
    }
    var o, i = FS.nodePermissions(e, "wx");
    if (i) return i;
    if (t) {
      if (!FS.isDir(o.mode)) return 54;
      if (FS.isRoot(o) || FS.getPath(o) === FS.cwd()) return 10
    } else if (FS.isDir(o.mode)) return 31;
    return 0
  },
  mayOpen: function (e, r) {
    return e ? FS.isLink(e.mode) ? 32 : FS.isDir(e.mode) && ("r" !== FS.flagsToPermissionString(r) || 512 & r) ? 31 : FS.nodePermissions(e, FS.flagsToPermissionString(r)) : 44
  },
  MAX_OPEN_FDS: 4096,
  nextfd: function (e, r) {
    e = e || 0, r = r || FS.MAX_OPEN_FDS;
    for (var t = e; t <= r; t++) if (!FS.streams[t]) return t;
    throw new FS.ErrnoError(33)
  },
  getStream: function (e) {
    return FS.streams[e]
  },
  createStream: function (e, r, t) {
    FS.FSStream || (FS.FSStream = function () {
    }, FS.FSStream.prototype = {
      object: {
        get: function () {
          return this.node
        }, set: function (e) {
          this.node = e
        }
      }, isRead: {
        get: function () {
          return (2097155 & this.flags) != 1
        }
      }, isWrite: {
        get: function () {
          return (2097155 & this.flags) != 0
        }
      }, isAppend: {
        get: function () {
          return 1024 & this.flags
        }
      }
    });
    var n = new FS.FSStream;
    for (var o in e) n[o] = e[o];
    e = n;
    var i = FS.nextfd(r, t);
    return e.fd = i, FS.streams[i] = e, e
  },
  closeStream: function (e) {
    FS.streams[e] = null
  },
  chrdev_stream_ops: {
    open: function (e) {
      var r = FS.getDevice(e.node.rdev);
      e.stream_ops = r.stream_ops, e.stream_ops.open && e.stream_ops.open(e)
    }, llseek: function () {
      throw new FS.ErrnoError(70)
    }
  },
  major: function (e) {
    return e >> 8
  },
  minor: function (e) {
    return 255 & e
  },
  makedev: function (e, r) {
    return e << 8 | r
  },
  registerDevice: function (e, r) {
    FS.devices[e] = {stream_ops: r}
  },
  getDevice: function (e) {
    return FS.devices[e]
  },
  getMounts: function (e) {
    for (var r = [], t = [e]; t.length;) {
      var n = t.pop();
      r.push(n), t.push.apply(t, n.mounts)
    }
    return r
  },
  syncfs: function (e, r) {
    "function" == typeof e && (r = e, e = !1), FS.syncFSRequests++, FS.syncFSRequests > 1 && err("warning: " + FS.syncFSRequests + " FS.syncfs operations in flight at once, probably just doing extra work");
    var t = FS.getMounts(FS.root.mount), n = 0;

    function o(e) {
      return FS.syncFSRequests--, r(e)
    }

    function i(e) {
      if (e) return i.errored ? void 0 : (i.errored = !0, o(e));
      ++n >= t.length && o(null)
    }

    t.forEach(function (r) {
      if (!r.type.syncfs) return i(null);
      r.type.syncfs(r, e, i)
    })
  },
  mount: function (e, r, t) {
    var n, o = "/" === t, i = !t;
    if (o && FS.root) throw new FS.ErrnoError(10);
    if (!o && !i) {
      var a = FS.lookupPath(t, {follow_mount: !1});
      if (t = a.path, n = a.node, FS.isMountpoint(n)) throw new FS.ErrnoError(10);
      if (!FS.isDir(n.mode)) throw new FS.ErrnoError(54)
    }
    var s = {type: e, opts: r, mountpoint: t, mounts: []}, u = e.mount(s);
    return u.mount = s, s.root = u, o ? FS.root = u : n && (n.mounted = s, n.mount && n.mount.mounts.push(s)), u
  },
  unmount: function (e) {
    var r = FS.lookupPath(e, {follow_mount: !1});
    if (!FS.isMountpoint(r.node)) throw new FS.ErrnoError(28);
    var t = r.node, n = t.mounted, o = FS.getMounts(n);
    Object.keys(FS.nameTable).forEach(function (e) {
      for (var r = FS.nameTable[e]; r;) {
        var t = r.name_next;
        -1 !== o.indexOf(r.mount) && FS.destroyNode(r), r = t
      }
    }), t.mounted = null;
    var i = t.mount.mounts.indexOf(n);
    t.mount.mounts.splice(i, 1)
  },
  lookup: function (e, r) {
    return e.node_ops.lookup(e, r)
  },
  mknod: function (e, r, t) {
    var n = FS.lookupPath(e, {parent: !0}).node, o = PATH.basename(e);
    if (!o || "." === o || ".." === o) throw new FS.ErrnoError(28);
    var i = FS.mayCreate(n, o);
    if (i) throw new FS.ErrnoError(i);
    if (!n.node_ops.mknod) throw new FS.ErrnoError(63);
    return n.node_ops.mknod(n, o, r, t)
  },
  create: function (e, r) {
    return r = void 0 !== r ? r : 438, r &= 4095, r |= 32768, FS.mknod(e, r, 0)
  },
  mkdir: function (e, r) {
    return r = void 0 !== r ? r : 511, r &= 1023, r |= 16384, FS.mknod(e, r, 0)
  },
  mkdirTree: function (e, r) {
    for (var t = e.split("/"), n = "", o = 0; o < t.length; ++o) if (t[o]) {
      n += "/" + t[o];
      try {
        FS.mkdir(n, r)
      } catch (i) {
        if (20 != i.errno) throw i
      }
    }
  },
  mkdev: function (e, r, t) {
    return void 0 === t && (t = r, r = 438), r |= 8192, FS.mknod(e, r, t)
  },
  symlink: function (e, r) {
    if (!PATH_FS.resolve(e)) throw new FS.ErrnoError(44);
    var t = FS.lookupPath(r, {parent: !0}).node;
    if (!t) throw new FS.ErrnoError(44);
    var n = PATH.basename(r), o = FS.mayCreate(t, n);
    if (o) throw new FS.ErrnoError(o);
    if (!t.node_ops.symlink) throw new FS.ErrnoError(63);
    return t.node_ops.symlink(t, n, e)
  },
  rename: function (e, r) {
    var t, n, o, i, a = PATH.dirname(e), s = PATH.dirname(r), u = PATH.basename(e), l = PATH.basename(r);
    if (n = (t = FS.lookupPath(e, {parent: !0})).node, o = (t = FS.lookupPath(r, {parent: !0})).node, !n || !o) throw new FS.ErrnoError(44);
    if (n.mount !== o.mount) throw new FS.ErrnoError(75);
    var c = FS.lookupNode(n, u), d = PATH_FS.relative(e, s);
    if ("." !== d.charAt(0)) throw new FS.ErrnoError(28);
    if ("." !== (d = PATH_FS.relative(r, a)).charAt(0)) throw new FS.ErrnoError(55);
    try {
      i = FS.lookupNode(o, l)
    } catch (f) {
    }
    if (c !== i) {
      var m = FS.isDir(c.mode), p = FS.mayDelete(n, u, m);
      if (p || (p = i ? FS.mayDelete(o, l, m) : FS.mayCreate(o, l))) throw new FS.ErrnoError(p);
      if (!n.node_ops.rename) throw new FS.ErrnoError(63);
      if (FS.isMountpoint(c) || i && FS.isMountpoint(i)) throw new FS.ErrnoError(10);
      if (o !== n && (p = FS.nodePermissions(n, "w"))) throw new FS.ErrnoError(p);
      try {
        FS.trackingDelegate.willMovePath && FS.trackingDelegate.willMovePath(e, r)
      } catch (S) {
        err("FS.trackingDelegate['willMovePath']('" + e + "', '" + r + "') threw an exception: " + S.message)
      }
      FS.hashRemoveNode(c);
      try {
        n.node_ops.rename(c, o, l)
      } catch (F) {
        throw F
      } finally {
        FS.hashAddNode(c)
      }
      try {
        FS.trackingDelegate.onMovePath && FS.trackingDelegate.onMovePath(e, r)
      } catch (h) {
        err("FS.trackingDelegate['onMovePath']('" + e + "', '" + r + "') threw an exception: " + h.message)
      }
    }
  },
  rmdir: function (e) {
    var r = FS.lookupPath(e, {parent: !0}).node, t = PATH.basename(e), n = FS.lookupNode(r, t),
      o = FS.mayDelete(r, t, !0);
    if (o) throw new FS.ErrnoError(o);
    if (!r.node_ops.rmdir) throw new FS.ErrnoError(63);
    if (FS.isMountpoint(n)) throw new FS.ErrnoError(10);
    try {
      FS.trackingDelegate.willDeletePath && FS.trackingDelegate.willDeletePath(e)
    } catch (i) {
      err("FS.trackingDelegate['willDeletePath']('" + e + "') threw an exception: " + i.message)
    }
    r.node_ops.rmdir(r, t), FS.destroyNode(n);
    try {
      FS.trackingDelegate.onDeletePath && FS.trackingDelegate.onDeletePath(e)
    } catch (a) {
      err("FS.trackingDelegate['onDeletePath']('" + e + "') threw an exception: " + a.message)
    }
  },
  readdir: function (e) {
    var r = FS.lookupPath(e, {follow: !0}).node;
    if (!r.node_ops.readdir) throw new FS.ErrnoError(54);
    return r.node_ops.readdir(r)
  },
  unlink: function (e) {
    var r = FS.lookupPath(e, {parent: !0}).node, t = PATH.basename(e), n = FS.lookupNode(r, t),
      o = FS.mayDelete(r, t, !1);
    if (o) throw new FS.ErrnoError(o);
    if (!r.node_ops.unlink) throw new FS.ErrnoError(63);
    if (FS.isMountpoint(n)) throw new FS.ErrnoError(10);
    try {
      FS.trackingDelegate.willDeletePath && FS.trackingDelegate.willDeletePath(e)
    } catch (i) {
      err("FS.trackingDelegate['willDeletePath']('" + e + "') threw an exception: " + i.message)
    }
    r.node_ops.unlink(r, t), FS.destroyNode(n);
    try {
      FS.trackingDelegate.onDeletePath && FS.trackingDelegate.onDeletePath(e)
    } catch (a) {
      err("FS.trackingDelegate['onDeletePath']('" + e + "') threw an exception: " + a.message)
    }
  },
  readlink: function (e) {
    var r = FS.lookupPath(e).node;
    if (!r) throw new FS.ErrnoError(44);
    if (!r.node_ops.readlink) throw new FS.ErrnoError(28);
    return PATH_FS.resolve(FS.getPath(r.parent), r.node_ops.readlink(r))
  },
  stat: function (e, r) {
    var t = FS.lookupPath(e, {follow: !r}).node;
    if (!t) throw new FS.ErrnoError(44);
    if (!t.node_ops.getattr) throw new FS.ErrnoError(63);
    return t.node_ops.getattr(t)
  },
  lstat: function (e) {
    return FS.stat(e, !0)
  },
  chmod: function (e, r, t) {
    var n;
    if (!(n = "string" == typeof e ? FS.lookupPath(e, {follow: !t}).node : e).node_ops.setattr) throw new FS.ErrnoError(63);
    n.node_ops.setattr(n, {mode: 4095 & r | -4096 & n.mode, timestamp: Date.now()})
  },
  lchmod: function (e, r) {
    FS.chmod(e, r, !0)
  },
  fchmod: function (e, r) {
    var t = FS.getStream(e);
    if (!t) throw new FS.ErrnoError(8);
    FS.chmod(t.node, r)
  },
  chown: function (e, r, t, n) {
    var o;
    if (!(o = "string" == typeof e ? FS.lookupPath(e, {follow: !n}).node : e).node_ops.setattr) throw new FS.ErrnoError(63);
    o.node_ops.setattr(o, {timestamp: Date.now()})
  },
  lchown: function (e, r, t) {
    FS.chown(e, r, t, !0)
  },
  fchown: function (e, r, t) {
    var n = FS.getStream(e);
    if (!n) throw new FS.ErrnoError(8);
    FS.chown(n.node, r, t)
  },
  truncate: function (e, r) {
    if (r < 0) throw new FS.ErrnoError(28);
    if ("string" == typeof e) {
      var t;
      t = FS.lookupPath(e, {follow: !0}).node
    } else t = e;
    if (!t.node_ops.setattr) throw new FS.ErrnoError(63);
    if (FS.isDir(t.mode)) throw new FS.ErrnoError(31);
    if (!FS.isFile(t.mode)) throw new FS.ErrnoError(28);
    var n = FS.nodePermissions(t, "w");
    if (n) throw new FS.ErrnoError(n);
    t.node_ops.setattr(t, {size: r, timestamp: Date.now()})
  },
  ftruncate: function (e, r) {
    var t = FS.getStream(e);
    if (!t) throw new FS.ErrnoError(8);
    if ((2097155 & t.flags) == 0) throw new FS.ErrnoError(28);
    FS.truncate(t.node, r)
  },
  utime: function (e, r, t) {
    var n = FS.lookupPath(e, {follow: !0}).node;
    n.node_ops.setattr(n, {timestamp: Math.max(r, t)})
  },
  open: function (e, r, t, n, o) {
    if ("" === e) throw new FS.ErrnoError(44);
    if (r = "string" == typeof r ? FS.modeStringToFlags(r) : r, t = void 0 === t ? 438 : t, t = 64 & r ? 4095 & t | 32768 : 0, "object" == typeof e) i = e; else {
      e = PATH.normalize(e);
      try {
        var i;
        i = FS.lookupPath(e, {follow: !(131072 & r)}).node
      } catch (a) {
      }
    }
    var s = !1;
    if (64 & r) {
      if (i) {
        if (128 & r) throw new FS.ErrnoError(20)
      } else i = FS.mknod(e, t, 0), s = !0
    }
    if (!i) throw new FS.ErrnoError(44);
    if (FS.isChrdev(i.mode) && (r &= -513), 65536 & r && !FS.isDir(i.mode)) throw new FS.ErrnoError(54);
    if (!s) {
      var u = FS.mayOpen(i, r);
      if (u) throw new FS.ErrnoError(u)
    }
    512 & r && FS.truncate(i, 0), r &= -131713;
    var l = FS.createStream({
      node: i,
      path: FS.getPath(i),
      flags: r,
      seekable: !0,
      position: 0,
      stream_ops: i.stream_ops,
      ungotten: [],
      error: !1
    }, n, o);
    l.stream_ops.open && l.stream_ops.open(l), !Module.logReadFiles || 1 & r || (FS.readFiles || (FS.readFiles = {}), e in FS.readFiles || (FS.readFiles[e] = 1, err("FS.trackingDelegate error on read file: " + e)));
    try {
      if (FS.trackingDelegate.onOpenFile) {
        var c = 0;
        (2097155 & r) != 1 && (c |= FS.tracking.openFlags.READ), (2097155 & r) != 0 && (c |= FS.tracking.openFlags.WRITE), FS.trackingDelegate.onOpenFile(e, c)
      }
    } catch (d) {
      err("FS.trackingDelegate['onOpenFile']('" + e + "', flags) threw an exception: " + d.message)
    }
    return l
  },
  close: function (e) {
    if (FS.isClosed(e)) throw new FS.ErrnoError(8);
    e.getdents && (e.getdents = null);
    try {
      e.stream_ops.close && e.stream_ops.close(e)
    } catch (r) {
      throw r
    } finally {
      FS.closeStream(e.fd)
    }
    e.fd = null
  },
  isClosed: function (e) {
    return null === e.fd
  },
  llseek: function (e, r, t) {
    if (FS.isClosed(e)) throw new FS.ErrnoError(8);
    if (!e.seekable || !e.stream_ops.llseek) throw new FS.ErrnoError(70);
    if (0 != t && 1 != t && 2 != t) throw new FS.ErrnoError(28);
    return e.position = e.stream_ops.llseek(e, r, t), e.ungotten = [], e.position
  },
  read: function (e, r, t, n, o) {
    if (n < 0 || o < 0) throw new FS.ErrnoError(28);
    if (FS.isClosed(e) || (2097155 & e.flags) == 1) throw new FS.ErrnoError(8);
    if (FS.isDir(e.node.mode)) throw new FS.ErrnoError(31);
    if (!e.stream_ops.read) throw new FS.ErrnoError(28);
    var i = void 0 !== o;
    if (i) {
      if (!e.seekable) throw new FS.ErrnoError(70)
    } else o = e.position;
    var a = e.stream_ops.read(e, r, t, n, o);
    return i || (e.position += a), a
  },
  write: function (e, r, t, n, o, i) {
    if (n < 0 || o < 0) throw new FS.ErrnoError(28);
    if (FS.isClosed(e) || (2097155 & e.flags) == 0) throw new FS.ErrnoError(8);
    if (FS.isDir(e.node.mode)) throw new FS.ErrnoError(31);
    if (!e.stream_ops.write) throw new FS.ErrnoError(28);
    e.seekable && 1024 & e.flags && FS.llseek(e, 0, 2);
    var a = void 0 !== o;
    if (a) {
      if (!e.seekable) throw new FS.ErrnoError(70)
    } else o = e.position;
    var s = e.stream_ops.write(e, r, t, n, o, i);
    a || (e.position += s);
    try {
      e.path && FS.trackingDelegate.onWriteToFile && FS.trackingDelegate.onWriteToFile(e.path)
    } catch (u) {
      err("FS.trackingDelegate['onWriteToFile']('" + e.path + "') threw an exception: " + u.message)
    }
    return s
  },
  allocate: function (e, r, t) {
    if (FS.isClosed(e)) throw new FS.ErrnoError(8);
    if (r < 0 || t <= 0) throw new FS.ErrnoError(28);
    if ((2097155 & e.flags) == 0) throw new FS.ErrnoError(8);
    if (!FS.isFile(e.node.mode) && !FS.isDir(e.node.mode)) throw new FS.ErrnoError(43);
    if (!e.stream_ops.allocate) throw new FS.ErrnoError(138);
    e.stream_ops.allocate(e, r, t)
  },
  mmap: function (e, r, t, n, o, i) {
    if ((2 & o) != 0 && (2 & i) == 0 && (2097155 & e.flags) != 2 || (2097155 & e.flags) == 1) throw new FS.ErrnoError(2);
    if (!e.stream_ops.mmap) throw new FS.ErrnoError(43);
    return e.stream_ops.mmap(e, r, t, n, o, i)
  },
  msync: function (e, r, t, n, o) {
    return e && e.stream_ops.msync ? e.stream_ops.msync(e, r, t, n, o) : 0
  },
  munmap: function (e) {
    return 0
  },
  ioctl: function (e, r, t) {
    if (!e.stream_ops.ioctl) throw new FS.ErrnoError(59);
    return e.stream_ops.ioctl(e, r, t)
  },
  readFile: function (e, r) {
    if ((r = r || {}).flags = r.flags || 0, r.encoding = r.encoding || "binary", "utf8" !== r.encoding && "binary" !== r.encoding) throw Error('Invalid encoding type "' + r.encoding + '"');
    var t, n = FS.open(e, r.flags), o = FS.stat(e).size, i = new Uint8Array(o);
    return FS.read(n, i, 0, o, 0), "utf8" === r.encoding ? t = UTF8ArrayToString(i, 0) : "binary" === r.encoding && (t = i), FS.close(n), t
  },
  writeFile: function (e, r, t) {
    (t = t || {}).flags = t.flags || 577;
    var n = FS.open(e, t.flags, t.mode);
    if ("string" == typeof r) {
      var o = new Uint8Array(lengthBytesUTF8(r) + 1), i = stringToUTF8Array(r, o, 0, o.length);
      FS.write(n, o, 0, i, void 0, t.canOwn)
    } else if (ArrayBuffer.isView(r)) FS.write(n, r, 0, r.byteLength, void 0, t.canOwn); else throw Error("Unsupported data type");
    FS.close(n)
  },
  cwd: function () {
    return FS.currentPath
  },
  chdir: function (e) {
    var r = FS.lookupPath(e, {follow: !0});
    if (null === r.node) throw new FS.ErrnoError(44);
    if (!FS.isDir(r.node.mode)) throw new FS.ErrnoError(54);
    var t = FS.nodePermissions(r.node, "x");
    if (t) throw new FS.ErrnoError(t);
    FS.currentPath = r.path
  },
  createDefaultDirectories: function () {
    FS.mkdir("/tmp"), FS.mkdir("/home"), FS.mkdir("/home/web_user")
  },
  createDefaultDevices: function () {
    FS.mkdir("/dev"), FS.registerDevice(FS.makedev(1, 3), {
      read: function () {
        return 0
      }, write: function (e, r, t, n, o) {
        return n
      }
    }), FS.mkdev("/dev/null", FS.makedev(1, 3)), TTY.register(FS.makedev(5, 0), TTY.default_tty_ops), TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops), FS.mkdev("/dev/tty", FS.makedev(5, 0)), FS.mkdev("/dev/tty1", FS.makedev(6, 0));
    var e = getRandomDevice();
    FS.createDevice("/dev", "random", e), FS.createDevice("/dev", "urandom", e), FS.mkdir("/dev/shm"), FS.mkdir("/dev/shm/tmp")
  },
  createSpecialDirectories: function () {
    FS.mkdir("/proc");
    var e = FS.mkdir("/proc/self");
    FS.mkdir("/proc/self/fd"), FS.mount({
      mount: function () {
        var r = FS.createNode(e, "fd", 16895, 73);
        return r.node_ops = {
          lookup: function (e, r) {
            var t = FS.getStream(+r);
            if (!t) throw new FS.ErrnoError(8);
            var n = {
              parent: null, mount: {mountpoint: "fake"}, node_ops: {
                readlink: function () {
                  return t.path
                }
              }
            };
            return n.parent = n, n
          }
        }, r
      }
    }, {}, "/proc/self/fd")
  },
  createStandardStreams: function () {
    Module.stdin ? FS.createDevice("/dev", "stdin", Module.stdin) : FS.symlink("/dev/tty", "/dev/stdin"), Module.stdout ? FS.createDevice("/dev", "stdout", null, Module.stdout) : FS.symlink("/dev/tty", "/dev/stdout"), Module.stderr ? FS.createDevice("/dev", "stderr", null, Module.stderr) : FS.symlink("/dev/tty1", "/dev/stderr"), FS.open("/dev/stdin", 0), FS.open("/dev/stdout", 1), FS.open("/dev/stderr", 1)
  },
  ensureErrnoError: function () {
    FS.ErrnoError || (FS.ErrnoError = function e(r, t) {
      this.node = t, this.setErrno = function (e) {
        this.errno = e
      }, this.setErrno(r), this.message = "FS error"
    }, FS.ErrnoError.prototype = Error(), FS.ErrnoError.prototype.constructor = FS.ErrnoError, [44].forEach(function (e) {
      FS.genericErrors[e] = new FS.ErrnoError(e), FS.genericErrors[e].stack = "<generic error, no stack>"
    }))
  },
  staticInit: function () {
    FS.ensureErrnoError(), FS.nameTable = Array(4096), FS.mount(MEMFS, {}, "/"), FS.createDefaultDirectories(), FS.createDefaultDevices(), FS.createSpecialDirectories(), FS.filesystems = {
      MEMFS: MEMFS,
      WORKERFS: WORKERFS
    }
  },
  init: function (e, r, t) {
    FS.init.initialized = !0, FS.ensureErrnoError(), Module.stdin = e || Module.stdin, Module.stdout = r || Module.stdout, Module.stderr = t || Module.stderr, FS.createStandardStreams()
  },
  quit: function () {
    FS.init.initialized = !1;
    var e = Module._fflush;
    e && e(0);
    for (var r = 0; r < FS.streams.length; r++) {
      var t = FS.streams[r];
      t && FS.close(t)
    }
  },
  getMode: function (e, r) {
    var t = 0;
    return e && (t |= 365), r && (t |= 146), t
  },
  findObject: function (e, r) {
    var t = FS.analyzePath(e, r);
    return t.exists ? t.object : null
  },
  analyzePath: function (e, r) {
    try {
      var t = FS.lookupPath(e, {follow: !r});
      e = t.path
    } catch (n) {
    }
    var o = {
      isRoot: !1,
      exists: !1,
      error: 0,
      name: null,
      path: null,
      object: null,
      parentExists: !1,
      parentPath: null,
      parentObject: null
    };
    try {
      var t = FS.lookupPath(e, {parent: !0});
      o.parentExists = !0, o.parentPath = t.path, o.parentObject = t.node, o.name = PATH.basename(e), t = FS.lookupPath(e, {follow: !r}), o.exists = !0, o.path = t.path, o.object = t.node, o.name = t.node.name, o.isRoot = "/" === t.path
    } catch (i) {
      o.error = i.errno
    }
    return o
  },
  createPath: function (e, r, t, n) {
    e = "string" == typeof e ? e : FS.getPath(e);
    for (var o = r.split("/").reverse(); o.length;) {
      var i = o.pop();
      if (i) {
        var a = PATH.join2(e, i);
        try {
          FS.mkdir(a)
        } catch (s) {
        }
        e = a
      }
    }
    return a
  },
  createFile: function (e, r, t, n, o) {
    var i = PATH.join2("string" == typeof e ? e : FS.getPath(e), r), a = FS.getMode(n, o);
    return FS.create(i, a)
  },
  createDataFile: function (e, r, t, n, o, i) {
    var a = r ? PATH.join2("string" == typeof e ? e : FS.getPath(e), r) : e, s = FS.getMode(n, o), u = FS.create(a, s);
    if (t) {
      if ("string" == typeof t) {
        for (var l = Array(t.length), c = 0, d = t.length; c < d; ++c) l[c] = t.charCodeAt(c);
        t = l
      }
      FS.chmod(u, 146 | s);
      var f = FS.open(u, 577);
      FS.write(f, t, 0, t.length, 0, i), FS.close(f), FS.chmod(u, s)
    }
    return u
  },
  createDevice: function (e, r, t, n) {
    var o = PATH.join2("string" == typeof e ? e : FS.getPath(e), r), i = FS.getMode(!!t, !!n);
    FS.createDevice.major || (FS.createDevice.major = 64);
    var a = FS.makedev(FS.createDevice.major++, 0);
    return FS.registerDevice(a, {
      open: function (e) {
        e.seekable = !1
      }, close: function (e) {
        n && n.buffer && n.buffer.length && n(10)
      }, read: function (e, r, n, o, i) {
        for (var a, s = 0, u = 0; u < o; u++) {
          try {
            a = t()
          } catch (l) {
            throw new FS.ErrnoError(29)
          }
          if (void 0 === a && 0 === s) throw new FS.ErrnoError(6);
          if (null == a) break;
          s++, r[n + u] = a
        }
        return s && (e.node.timestamp = Date.now()), s
      }, write: function (e, r, t, o, i) {
        for (var a = 0; a < o; a++) try {
          n(r[t + a])
        } catch (s) {
          throw new FS.ErrnoError(29)
        }
        return o && (e.node.timestamp = Date.now()), a
      }
    }), FS.mkdev(o, i, a)
  },
  forceLoadFile: function (e) {
    if (e.isDevice || e.isFolder || e.link || e.contents) return !0;
    if ("undefined" != typeof XMLHttpRequest) throw Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
    if (read_) try {
      e.contents = intArrayFromString(read_(e.url), !0), e.usedBytes = e.contents.length
    } catch (r) {
      throw new FS.ErrnoError(29)
    } else throw Error("Cannot load without read() or XMLHttpRequest.")
  },
  createLazyFile: function (e, r, t, n, o) {
    function i() {
      this.lengthKnown = !1, this.chunks = []
    }

    if (i.prototype.get = function e(r) {
      if (!(r > this.length - 1) && !(r < 0)) {
        var t = r % this.chunkSize, n = r / this.chunkSize | 0;
        return this.getter(n)[t]
      }
    }, i.prototype.setDataGetter = function e(r) {
      this.getter = r
    }, i.prototype.cacheLength = function e() {
      var r, n = new XMLHttpRequest;
      if (n.open("HEAD", t, !1), n.send(null), !(n.status >= 200 && n.status < 300 || 304 === n.status)) throw Error("Couldn't load " + t + ". Status: " + n.status);
      var o = Number(n.getResponseHeader("Content-length")),
        i = (r = n.getResponseHeader("Accept-Ranges")) && "bytes" === r,
        a = (r = n.getResponseHeader("Content-Encoding")) && "gzip" === r, s = 1048576;
      i || (s = o);
      var u = function (e, r) {
        if (e > r) throw Error("invalid range (" + e + ", " + r + ") or no bytes requested!");
        if (r > o - 1) throw Error("only " + o + " bytes available! programmer error!");
        var n = new XMLHttpRequest;
        if (n.open("GET", t, !1), o !== s && n.setRequestHeader("Range", "bytes=" + e + "-" + r), "undefined" != typeof Uint8Array && (n.responseType = "arraybuffer"), n.overrideMimeType && n.overrideMimeType("text/plain; charset=x-user-defined"), n.send(null), !(n.status >= 200 && n.status < 300 || 304 === n.status)) throw Error("Couldn't load " + t + ". Status: " + n.status);
        return void 0 !== n.response ? new Uint8Array(n.response || []) : intArrayFromString(n.responseText || "", !0)
      }, l = this;
      l.setDataGetter(function (e) {
        var r = e * s, t = (e + 1) * s - 1;
        if (t = Math.min(t, o - 1), void 0 === l.chunks[e] && (l.chunks[e] = u(r, t)), void 0 === l.chunks[e]) throw Error("doXHR failed!");
        return l.chunks[e]
      }), (a || !o) && (s = o = 1, s = o = this.getter(0).length, out("LazyFiles on gzip forces download of the whole file when length is accessed")), this._length = o, this._chunkSize = s, this.lengthKnown = !0
    }, "undefined" != typeof XMLHttpRequest) {
      if (!ENVIRONMENT_IS_WORKER) throw"Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
      var a = new i;
      Object.defineProperties(a, {
        length: {
          get: function () {
            return this.lengthKnown || this.cacheLength(), this._length
          }
        }, chunkSize: {
          get: function () {
            return this.lengthKnown || this.cacheLength(), this._chunkSize
          }
        }
      });
      var s = {isDevice: !1, contents: a}
    } else var s = {isDevice: !1, url: t};
    var u = FS.createFile(e, r, s, n, o);
    s.contents ? u.contents = s.contents : s.url && (u.contents = null, u.url = s.url), Object.defineProperties(u, {
      usedBytes: {
        get: function () {
          return this.contents.length
        }
      }
    });
    var l = {};
    return Object.keys(u.stream_ops).forEach(function (e) {
      var r = u.stream_ops[e];
      l[e] = function e() {
        return FS.forceLoadFile(u), r.apply(null, arguments)
      }
    }), l.read = function e(r, t, n, o, i) {
      FS.forceLoadFile(u);
      var a = r.node.contents;
      if (i >= a.length) return 0;
      var s = Math.min(a.length - i, o);
      if (a.slice) for (var l = 0; l < s; l++) t[n + l] = a[i + l]; else for (var l = 0; l < s; l++) t[n + l] = a.get(i + l);
      return s
    }, u.stream_ops = l, u
  },
  createPreloadedFile: function (e, r, t, n, o, i, a, s, u, l) {
    Browser.init();
    var c = r ? PATH_FS.resolve(PATH.join2(e, r)) : e, d = getUniqueRunDependency("cp " + c);

    function f(t) {
      function f(t) {
        l && l(), s || FS.createDataFile(e, r, t, n, o, u), i && i(), removeRunDependency(d)
      }

      var m = !1;
      Module.preloadPlugins.forEach(function (e) {
        !m && e.canHandle(c) && (e.handle(t, c, f, function () {
          a && a(), removeRunDependency(d)
        }), m = !0)
      }), m || f(t)
    }

    addRunDependency(d), "string" == typeof t ? Browser.asyncLoad(t, function (e) {
      f(e)
    }, a) : f(t)
  },
  indexedDB: function () {
    return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB
  },
  DB_NAME: function () {
    return "EM_FS_" + window.location.pathname
  },
  DB_VERSION: 20,
  DB_STORE_NAME: "FILE_DATA",
  saveFilesToDB: function (e, r, t) {
    r = r || function () {
    }, t = t || function () {
    };
    var n = FS.indexedDB();
    try {
      var o = n.open(FS.DB_NAME(), FS.DB_VERSION)
    } catch (i) {
      return t(i)
    }
    o.onupgradeneeded = function e() {
      out("creating db"), o.result.createObjectStore(FS.DB_STORE_NAME)
    }, o.onsuccess = function n() {
      var i = o.result.transaction([FS.DB_STORE_NAME], "readwrite"), a = i.objectStore(FS.DB_STORE_NAME), s = 0, u = 0,
        l = e.length;

      function c() {
        0 == u ? r() : t()
      }

      e.forEach(function (e) {
        var r = a.put(FS.analyzePath(e).object.contents, e);
        r.onsuccess = function e() {
          ++s + u == l && c()
        }, r.onerror = function e() {
          s + ++u == l && c()
        }
      }), i.onerror = t
    }, o.onerror = t
  },
  loadFilesFromDB: function (e, r, t) {
    r = r || function () {
    }, t = t || function () {
    };
    var n = FS.indexedDB();
    try {
      var o = n.open(FS.DB_NAME(), FS.DB_VERSION)
    } catch (i) {
      return t(i)
    }
    o.onupgradeneeded = t, o.onsuccess = function n() {
      var i = o.result;
      try {
        var a = i.transaction([FS.DB_STORE_NAME], "readonly")
      } catch (s) {
        t(s);
        return
      }
      var u = a.objectStore(FS.DB_STORE_NAME), l = 0, c = 0, d = e.length;

      function f() {
        0 == c ? r() : t()
      }

      e.forEach(function (e) {
        var r = u.get(e);
        r.onsuccess = function t() {
          FS.analyzePath(e).exists && FS.unlink(e), FS.createDataFile(PATH.dirname(e), PATH.basename(e), r.result, !0, !0, !0), ++l + c == d && f()
        }, r.onerror = function e() {
          l + ++c == d && f()
        }
      }), a.onerror = t
    }, o.onerror = t
  }
}, SYSCALLS = {
  mappings: {}, DEFAULT_POLLMASK: 5, umask: 511, calculateAt: function (e, r, t) {
    if ("/" === r[0]) return r;
    if (-100 === e) n = FS.cwd(); else {
      var n, o = FS.getStream(e);
      if (!o) throw new FS.ErrnoError(8);
      n = o.path
    }
    if (0 == r.length) {
      if (!t) throw new FS.ErrnoError(44);
      return n
    }
    return PATH.join2(n, r)
  }, doStat: function (e, r, t) {
    try {
      var n = e(r)
    } catch (o) {
      if (o && o.node && PATH.normalize(r) !== PATH.normalize(FS.getPath(o.node))) return -54;
      throw o
    }
    return HEAP32[t >> 2] = n.dev, HEAP32[t + 4 >> 2] = 0, HEAP32[t + 8 >> 2] = n.ino, HEAP32[t + 12 >> 2] = n.mode, HEAP32[t + 16 >> 2] = n.nlink, HEAP32[t + 20 >> 2] = n.uid, HEAP32[t + 24 >> 2] = n.gid, HEAP32[t + 28 >> 2] = n.rdev, HEAP32[t + 32 >> 2] = 0, tempI64 = [n.size >>> 0, +Math.abs(tempDouble = n.size) >= 1 ? tempDouble > 0 ? (0 | Math.min(+Math.floor(tempDouble / 4294967296), 4294967295)) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0], HEAP32[t + 40 >> 2] = tempI64[0], HEAP32[t + 44 >> 2] = tempI64[1], HEAP32[t + 48 >> 2] = 4096, HEAP32[t + 52 >> 2] = n.blocks, HEAP32[t + 56 >> 2] = n.atime.getTime() / 1e3 | 0, HEAP32[t + 60 >> 2] = 0, HEAP32[t + 64 >> 2] = n.mtime.getTime() / 1e3 | 0, HEAP32[t + 68 >> 2] = 0, HEAP32[t + 72 >> 2] = n.ctime.getTime() / 1e3 | 0, HEAP32[t + 76 >> 2] = 0, tempI64 = [n.ino >>> 0, +Math.abs(tempDouble = n.ino) >= 1 ? tempDouble > 0 ? (0 | Math.min(+Math.floor(tempDouble / 4294967296), 4294967295)) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0], HEAP32[t + 80 >> 2] = tempI64[0], HEAP32[t + 84 >> 2] = tempI64[1], 0
  }, doMsync: function (e, r, t, n, o) {
    var i = HEAPU8.slice(e, e + t);
    FS.msync(r, i, o, t, n)
  }, doMkdir: function (e, r) {
    return "/" === (e = PATH.normalize(e))[e.length - 1] && (e = e.substr(0, e.length - 1)), FS.mkdir(e, r, 0), 0
  }, doMknod: function (e, r, t) {
    switch (61440 & r) {
      case 32768:
      case 8192:
      case 24576:
      case 4096:
      case 49152:
        break;
      default:
        return -28
    }
    return FS.mknod(e, r, t), 0
  }, doReadlink: function (e, r, t) {
    if (t <= 0) return -28;
    var n = FS.readlink(e), o = Math.min(t, lengthBytesUTF8(n)), i = HEAP8[r + o];
    return stringToUTF8(n, r, t + 1), HEAP8[r + o] = i, o
  }, doAccess: function (e, r) {
    if (-8 & r) return -28;
    if (!(t = FS.lookupPath(e, {follow: !0}).node)) return -44;
    var t, n = "";
    return (4 & r && (n += "r"), 2 & r && (n += "w"), 1 & r && (n += "x"), n && FS.nodePermissions(t, n)) ? -2 : 0
  }, doDup: function (e, r, t) {
    var n = FS.getStream(t);
    return n && FS.close(n), FS.open(e, r, 0, t, t).fd
  }, doReadv: function (e, r, t, n) {
    for (var o = 0, i = 0; i < t; i++) {
      var a = HEAP32[r + 8 * i >> 2], s = HEAP32[r + (8 * i + 4) >> 2], u = FS.read(e, HEAP8, a, s, n);
      if (u < 0) return -1;
      if (o += u, u < s) break
    }
    return o
  }, doWritev: function (e, r, t, n) {
    for (var o = 0, i = 0; i < t; i++) {
      var a = HEAP32[r + 8 * i >> 2], s = HEAP32[r + (8 * i + 4) >> 2], u = FS.write(e, HEAP8, a, s, n);
      if (u < 0) return -1;
      o += u
    }
    return o
  }, varargs: void 0, get: function () {
    return SYSCALLS.varargs += 4, HEAP32[SYSCALLS.varargs - 4 >> 2]
  }, getStr: function (e) {
    return UTF8ToString(e)
  }, getStreamFromFD: function (e) {
    var r = FS.getStream(e);
    if (!r) throw new FS.ErrnoError(8);
    return r
  }, get64: function (e, r) {
    return e
  }
};

function ___sys_fcntl64(e, r, t) {
  SYSCALLS.varargs = t;
  try {
    var n = SYSCALLS.getStreamFromFD(e);
    switch (r) {
      case 0:
        var o, i = SYSCALLS.get();
        if (i < 0) return -28;
        return (o = FS.open(n.path, n.flags, 0, i)).fd;
      case 1:
      case 2:
      case 13:
      case 14:
        return 0;
      case 3:
        return n.flags;
      case 4:
        var i = SYSCALLS.get();
        return n.flags |= i, 0;
      case 12:
        var i = SYSCALLS.get();
        return HEAP16[i + 0 >> 1] = 2, 0;
      case 16:
      case 8:
      default:
        return -28;
      case 9:
        return setErrNo(28), -1
    }
  } catch (a) {
    return void 0 !== FS && a instanceof FS.ErrnoError || abort(a), -a.errno
  }
}

function ___sys_getdents64(e, r, t) {
  try {
    var n = SYSCALLS.getStreamFromFD(e);
    n.getdents || (n.getdents = FS.readdir(n.path));
    for (var o = 0, i = FS.llseek(n, 0, 1), a = Math.floor(i / 280); a < n.getdents.length && o + 280 <= t;) {
      var s, u, l = n.getdents[a];
      if ("." === l[0]) s = 1, u = 4; else {
        var c = FS.lookupNode(n.node, l);
        s = c.id, u = FS.isChrdev(c.mode) ? 2 : FS.isDir(c.mode) ? 4 : FS.isLink(c.mode) ? 10 : 8
      }
      tempI64 = [s >>> 0, (tempDouble = s, +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? (0 | Math.min(+Math.floor(tempDouble / 4294967296), 4294967295)) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[r + o >> 2] = tempI64[0], HEAP32[r + o + 4 >> 2] = tempI64[1], tempI64 = [(a + 1) * 280 >>> 0, (tempDouble = (a + 1) * 280, +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? (0 | Math.min(+Math.floor(tempDouble / 4294967296), 4294967295)) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[r + o + 8 >> 2] = tempI64[0], HEAP32[r + o + 12 >> 2] = tempI64[1], HEAP16[r + o + 16 >> 1] = 280, HEAP8[r + o + 18 >> 0] = u, stringToUTF8(l, r + o + 19, 256), o += 280, a += 1
    }
    return FS.llseek(n, 280 * a, 0), o
  } catch (d) {
    return void 0 !== FS && d instanceof FS.ErrnoError || abort(d), -d.errno
  }
}

function ___sys_ioctl(e, r, t) {
  SYSCALLS.varargs = t;
  try {
    var n = SYSCALLS.getStreamFromFD(e);
    switch (r) {
      case 21509:
      case 21505:
      case 21510:
      case 21511:
      case 21512:
      case 21506:
      case 21507:
      case 21508:
      case 21523:
      case 21524:
        if (!n.tty) return -59;
        return 0;
      case 21519:
        if (!n.tty) return -59;
        var o = SYSCALLS.get();
        return HEAP32[o >> 2] = 0, 0;
      case 21520:
        if (!n.tty) return -59;
        return -28;
      case 21531:
        var o = SYSCALLS.get();
        return FS.ioctl(n, r, o);
      default:
        abort("bad ioctl syscall " + r)
    }
  } catch (i) {
    return void 0 !== FS && i instanceof FS.ErrnoError || abort(i), -i.errno
  }
}

function ___sys_lstat64(e, r) {
  try {
    return e = SYSCALLS.getStr(e), SYSCALLS.doStat(FS.lstat, e, r)
  } catch (t) {
    return void 0 !== FS && t instanceof FS.ErrnoError || abort(t), -t.errno
  }
}

function ___sys_mkdir(e, r) {
  try {
    return e = SYSCALLS.getStr(e), SYSCALLS.doMkdir(e, r)
  } catch (t) {
    return void 0 !== FS && t instanceof FS.ErrnoError || abort(t), -t.errno
  }
}

function ___sys_open(e, r, t) {
  SYSCALLS.varargs = t;
  try {
    var n = SYSCALLS.getStr(e), o = t ? SYSCALLS.get() : 0;
    return FS.open(n, r, o).fd
  } catch (i) {
    return void 0 !== FS && i instanceof FS.ErrnoError || abort(i), -i.errno
  }
}

function ___sys_readlink(e, r, t) {
  try {
    return e = SYSCALLS.getStr(e), SYSCALLS.doReadlink(e, r, t)
  } catch (n) {
    return void 0 !== FS && n instanceof FS.ErrnoError || abort(n), -n.errno
  }
}

function ___sys_rmdir(e) {
  try {
    return e = SYSCALLS.getStr(e), FS.rmdir(e), 0
  } catch (r) {
    return void 0 !== FS && r instanceof FS.ErrnoError || abort(r), -r.errno
  }
}

function ___sys_stat64(e, r) {
  try {
    return e = SYSCALLS.getStr(e), SYSCALLS.doStat(FS.stat, e, r)
  } catch (t) {
    return void 0 !== FS && t instanceof FS.ErrnoError || abort(t), -t.errno
  }
}

function ___sys_unlink(e) {
  try {
    return e = SYSCALLS.getStr(e), FS.unlink(e), 0
  } catch (r) {
    return void 0 !== FS && r instanceof FS.ErrnoError || abort(r), -r.errno
  }
}

var structRegistrations = {};

function runDestructors(e) {
  for (; e.length;) {
    var r = e.pop();
    e.pop()(r)
  }
}

function simpleReadValueFromPointer(e) {
  return this.fromWireType(HEAPU32[e >> 2])
}

var awaitingDependencies = {}, registeredTypes = {}, typeDependencies = {}, char_0 = 48, char_9 = 57;

function makeLegalFunctionName(e) {
  if (void 0 === e) return "_unknown";
  var r = (e = e.replace(/[^a-zA-Z0-9_]/g, "$")).charCodeAt(0);
  return r >= char_0 && r <= char_9 ? "_" + e : e
}

function createNamedFunction(e, r) {
  return Function("body", "return function " + (e = makeLegalFunctionName(e)) + '() {\n    "use strict";    return body.apply(this, arguments);\n};\n')(r)
}

function extendError(e, r) {
  var t = createNamedFunction(r, function (e) {
    this.name = r, this.message = e;
    var t = Error(e).stack;
    void 0 !== t && (this.stack = this.toString() + "\n" + t.replace(/^Error(:[^\n]*)?\n/, ""))
  });
  return t.prototype = Object.create(e.prototype), t.prototype.constructor = t, t.prototype.toString = function () {
    return void 0 === this.message ? this.name : this.name + ": " + this.message
  }, t
}

var InternalError = void 0;

function throwInternalError(e) {
  throw new InternalError(e)
}

function whenDependentTypesAreResolved(e, r, t) {
  function n(r) {
    var n = t(r);
    n.length !== e.length && throwInternalError("Mismatched type converter count");
    for (var o = 0; o < e.length; ++o) registerType(e[o], n[o])
  }

  e.forEach(function (e) {
    typeDependencies[e] = r
  });
  var o = Array(r.length), i = [], a = 0;
  r.forEach(function (e, r) {
    registeredTypes.hasOwnProperty(e) ? o[r] = registeredTypes[e] : (i.push(e), awaitingDependencies.hasOwnProperty(e) || (awaitingDependencies[e] = []), awaitingDependencies[e].push(function () {
      o[r] = registeredTypes[e], ++a === i.length && n(o)
    }))
  }), 0 === i.length && n(o)
}

function __embind_finalize_value_object(e) {
  var r = structRegistrations[e];
  delete structRegistrations[e];
  var t = r.rawConstructor, n = r.rawDestructor, o = r.fields;
  whenDependentTypesAreResolved([e], o.map(function (e) {
    return e.getterReturnType
  }).concat(o.map(function (e) {
    return e.setterArgumentType
  })), function (e) {
    var i = {};
    return o.forEach(function (r, t) {
      var n = r.fieldName, a = e[t], s = r.getter, u = r.getterContext, l = e[t + o.length], c = r.setter,
        d = r.setterContext;
      i[n] = {
        read: function (e) {
          return a.fromWireType(s(u, e))
        }, write: function (e, r) {
          var t = [];
          c(d, e, l.toWireType(t, r)), runDestructors(t)
        }
      }
    }), [{
      name: r.name, fromWireType: function (e) {
        var r = {};
        for (var t in i) r[t] = i[t].read(e);
        return n(e), r
      }, toWireType: function (e, r) {
        var o = t();
        for (fieldName in i) fieldName in r && i[fieldName].write(o, r[fieldName]);
        return null !== e && e.push(n, o), o
      }, argPackAdvance: 8, readValueFromPointer: simpleReadValueFromPointer, destructorFunction: n
    }]
  })
}

function getShiftFromSize(e) {
  switch (e) {
    case 1:
      return 0;
    case 2:
      return 1;
    case 4:
      return 2;
    case 8:
      return 3;
    default:
      throw TypeError("Unknown type size: " + e)
  }
}

function embind_init_charCodes() {
  for (var e = Array(256), r = 0; r < 256; ++r) e[r] = String.fromCharCode(r);
  embind_charCodes = e
}

var embind_charCodes = void 0;

function readLatin1String(e) {
  for (var r = "", t = e; HEAPU8[t];) r += embind_charCodes[HEAPU8[t++]];
  return r
}

var BindingError = void 0;

function throwBindingError(e) {
  throw new BindingError(e)
}

function registerType(e, r, t) {
  if (t = t || {}, !("argPackAdvance" in r)) throw TypeError("registerType registeredInstance requires argPackAdvance");
  var n = r.name;
  if (e || throwBindingError('type "' + n + '" must have a positive integer typeid pointer'), registeredTypes.hasOwnProperty(e)) {
    if (t.ignoreDuplicateRegistrations) return;
    throwBindingError("Cannot register type '" + n + "' twice")
  }
  if (registeredTypes[e] = r, delete typeDependencies[e], awaitingDependencies.hasOwnProperty(e)) {
    var o = awaitingDependencies[e];
    delete awaitingDependencies[e], o.forEach(function (e) {
      e()
    })
  }
}

function __embind_register_bool(e, r, t, n, o) {
  var i = getShiftFromSize(t);
  r = readLatin1String(r), registerType(e, {
    name: r, fromWireType: function (e) {
      return !!e
    }, toWireType: function (e, r) {
      return r ? n : o
    }, argPackAdvance: 8, readValueFromPointer: function (e) {
      var n;
      if (1 === t) n = HEAP8; else if (2 === t) n = HEAP16; else if (4 === t) n = HEAP32; else throw TypeError("Unknown boolean type size: " + r);
      return this.fromWireType(n[e >> i])
    }, destructorFunction: null
  })
}

var emval_free_list = [], emval_handle_array = [{}, {value: void 0}, {value: null}, {value: !0}, {value: !1}];

function __emval_decref(e) {
  e > 4 && 0 == --emval_handle_array[e].refcount && (emval_handle_array[e] = void 0, emval_free_list.push(e))
}

function count_emval_handles() {
  for (var e = 0, r = 5; r < emval_handle_array.length; ++r) void 0 !== emval_handle_array[r] && ++e;
  return e
}

function get_first_emval() {
  for (var e = 5; e < emval_handle_array.length; ++e) if (void 0 !== emval_handle_array[e]) return emval_handle_array[e];
  return null
}

function init_emval() {
  Module.count_emval_handles = count_emval_handles, Module.get_first_emval = get_first_emval
}

function __emval_register(e) {
  switch (e) {
    case void 0:
      return 1;
    case null:
      return 2;
    case!0:
      return 3;
    case!1:
      return 4;
    default:
      var r = emval_free_list.length ? emval_free_list.pop() : emval_handle_array.length;
      return emval_handle_array[r] = {refcount: 1, value: e}, r
  }
}

function __embind_register_emval(e, r) {
  r = readLatin1String(r), registerType(e, {
    name: r, fromWireType: function (e) {
      var r = emval_handle_array[e].value;
      return __emval_decref(e), r
    }, toWireType: function (e, r) {
      return __emval_register(r)
    }, argPackAdvance: 8, readValueFromPointer: simpleReadValueFromPointer, destructorFunction: null
  })
}

function _embind_repr(e) {
  if (null === e) return "null";
  var r = typeof e;
  return "object" === r || "array" === r || "function" === r ? e.toString() : "" + e
}

function floatReadValueFromPointer(e, r) {
  switch (r) {
    case 2:
      return function (e) {
        return this.fromWireType(HEAPF32[e >> 2])
      };
    case 3:
      return function (e) {
        return this.fromWireType(HEAPF64[e >> 3])
      };
    default:
      throw TypeError("Unknown float type: " + e)
  }
}

function __embind_register_float(e, r, t) {
  var n = getShiftFromSize(t);
  r = readLatin1String(r), registerType(e, {
    name: r, fromWireType: function (e) {
      return e
    }, toWireType: function (e, r) {
      if ("number" != typeof r && "boolean" != typeof r) throw TypeError('Cannot convert "' + _embind_repr(r) + '" to ' + this.name);
      return r
    }, argPackAdvance: 8, readValueFromPointer: floatReadValueFromPointer(r, n), destructorFunction: null
  })
}

function new_(e, r) {
  if (!(e instanceof Function)) throw TypeError("new_ called with constructor type " + typeof e + " which is not a function");
  var t = createNamedFunction(e.name || "unknownFunctionName", function () {
  });
  t.prototype = e.prototype;
  var n = new t, o = e.apply(n, r);
  return o instanceof Object ? o : n
}

function craftInvokerFunction(e, r, t, n, o) {
  var i = r.length;
  i < 2 && throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
  for (var a = null !== r[1] && null !== t, s = !1, u = 1; u < r.length; ++u) if (null !== r[u] && void 0 === r[u].destructorFunction) {
    s = !0;
    break
  }
  for (var l = "void" !== r[0].name, c = "", d = "", u = 0; u < i - 2; ++u) c += (0 !== u ? ", " : "") + "arg" + u, d += (0 !== u ? ", " : "") + "arg" + u + "Wired";
  var f = "return function " + makeLegalFunctionName(e) + "(" + c + ") {\nif (arguments.length !== " + (i - 2) + ") {\nthrowBindingError('function " + e + " called with ' + arguments.length + ' arguments, expected " + (i - 2) + " args!');\n}\n";
  s && (f += "var destructors = [];\n");
  var m = s ? "destructors" : "null",
    p = ["throwBindingError", "invoker", "fn", "runDestructors", "retType", "classParam"],
    S = [throwBindingError, n, o, runDestructors, r[0], r[1]];
  a && (f += "var thisWired = classParam.toWireType(" + m + ", this);\n");
  for (var u = 0; u < i - 2; ++u) f += "var arg" + u + "Wired = argType" + u + ".toWireType(" + m + ", arg" + u + "); // " + r[u + 2].name + "\n", p.push("argType" + u), S.push(r[u + 2]);
  if (a && (d = "thisWired" + (d.length > 0 ? ", " : "") + d), f += (l ? "var rv = " : "") + "invoker(fn" + (d.length > 0 ? ", " : "") + d + ");\n", s) f += "runDestructors(destructors);\n"; else for (var u = a ? 1 : 2; u < r.length; ++u) {
    var F = 1 === u ? "thisWired" : "arg" + (u - 2) + "Wired";
    null !== r[u].destructorFunction && (f += F + "_dtor(" + F + "); // " + r[u].name + "\n", p.push(F + "_dtor"), S.push(r[u].destructorFunction))
  }
  return l && (f += "var ret = retType.fromWireType(rv);\nreturn ret;\n"), f += "}\n", p.push(f), new_(Function, p).apply(null, S)
}

function ensureOverloadTable(e, r, t) {
  if (void 0 === e[r].overloadTable) {
    var n = e[r];
    e[r] = function () {
      return e[r].overloadTable.hasOwnProperty(arguments.length) || throwBindingError("Function '" + t + "' called with an invalid number of arguments (" + arguments.length + ") - expects one of (" + e[r].overloadTable + ")!"), e[r].overloadTable[arguments.length].apply(this, arguments)
    }, e[r].overloadTable = [], e[r].overloadTable[n.argCount] = n
  }
}

function exposePublicSymbol(e, r, t) {
  Module.hasOwnProperty(e) ? ((void 0 === t || void 0 !== Module[e].overloadTable && void 0 !== Module[e].overloadTable[t]) && throwBindingError("Cannot register public name '" + e + "' twice"), ensureOverloadTable(Module, e, e), Module.hasOwnProperty(t) && throwBindingError("Cannot register multiple overloads of a function with the same number of arguments (" + t + ")!"), Module[e].overloadTable[t] = r) : (Module[e] = r, void 0 !== t && (Module[e].numArguments = t))
}

function heap32VectorToArray(e, r) {
  for (var t = [], n = 0; n < e; n++) t.push(HEAP32[(r >> 2) + n]);
  return t
}

function replacePublicSymbol(e, r, t) {
  Module.hasOwnProperty(e) || throwInternalError("Replacing nonexistant public symbol"), void 0 !== Module[e].overloadTable && void 0 !== t ? Module[e].overloadTable[t] = r : (Module[e] = r, Module[e].argCount = t)
}

function dynCallLegacy(e, r, t) {
  var n = Module["dynCall_" + e];
  return t && t.length ? n.apply(null, [r].concat(t)) : n.call(null, r)
}

function dynCall(e, r, t) {
  return -1 != e.indexOf("j") ? dynCallLegacy(e, r, t) : wasmTable.get(r).apply(null, t)
}

function getDynCaller(e, r) {
  var t = [];
  return function () {
    t.length = arguments.length;
    for (var n = 0; n < arguments.length; n++) t[n] = arguments[n];
    return dynCall(e, r, t)
  }
}

function embind__requireFunction(e, r) {
  var t = -1 != (e = readLatin1String(e)).indexOf("j") ? getDynCaller(e, r) : wasmTable.get(r);
  return "function" != typeof t && throwBindingError("unknown function pointer with signature " + e + ": " + r), t
}

var UnboundTypeError = void 0;

function getTypeName(e) {
  var r = ___getTypeName(e), t = readLatin1String(r);
  return _free(r), t
}

function throwUnboundTypeError(e, r) {
  var t = [], n = {};

  function o(e) {
    if (!n[e] && !registeredTypes[e]) {
      if (typeDependencies[e]) {
        typeDependencies[e].forEach(o);
        return
      }
      t.push(e), n[e] = !0
    }
  }

  throw r.forEach(o), new UnboundTypeError(e + ": " + t.map(getTypeName).join([", "]))
}

function __embind_register_function(e, r, t, n, o, i) {
  var a = heap32VectorToArray(r, t);
  e = readLatin1String(e), o = embind__requireFunction(n, o), exposePublicSymbol(e, function () {
    throwUnboundTypeError("Cannot call " + e + " due to unbound types", a)
  }, r - 1), whenDependentTypesAreResolved([], a, function (t) {
    return replacePublicSymbol(e, craftInvokerFunction(e, [t[0], null].concat(t.slice(1)), null, o, i), r - 1), []
  })
}

function integerReadValueFromPointer(e, r, t) {
  switch (r) {
    case 0:
      return t ? function e(r) {
        return HEAP8[r]
      } : function e(r) {
        return HEAPU8[r]
      };
    case 1:
      return t ? function e(r) {
        return HEAP16[r >> 1]
      } : function e(r) {
        return HEAPU16[r >> 1]
      };
    case 2:
      return t ? function e(r) {
        return HEAP32[r >> 2]
      } : function e(r) {
        return HEAPU32[r >> 2]
      };
    default:
      throw TypeError("Unknown integer type: " + e)
  }
}

function __embind_register_integer(e, r, t, n, o) {
  r = readLatin1String(r), -1 === o && (o = 4294967295);
  var i = getShiftFromSize(t), a = function (e) {
    return e
  };
  if (0 === n) {
    var s = 32 - 8 * t;
    a = function (e) {
      return e << s >>> s
    }
  }
  var u = -1 != r.indexOf("unsigned");
  registerType(e, {
    name: r, fromWireType: a, toWireType: function (e, t) {
      if ("number" != typeof t && "boolean" != typeof t) throw TypeError('Cannot convert "' + _embind_repr(t) + '" to ' + this.name);
      if (t < n || t > o) throw TypeError('Passing a number "' + _embind_repr(t) + '" from JS side to C/C++ side to an argument of type "' + r + '", which is outside the valid range [' + n + ", " + o + "]!");
      return u ? t >>> 0 : 0 | t
    }, argPackAdvance: 8, readValueFromPointer: integerReadValueFromPointer(r, i, 0 !== n), destructorFunction: null
  })
}

function __embind_register_memory_view(e, r, t) {
  var n = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array][r];

  function o(e) {
    var r = HEAPU32, t = r[e >>= 2], o = r[e + 1];
    return new n(buffer, o, t)
  }

  t = readLatin1String(t), registerType(e, {
    name: t,
    fromWireType: o,
    argPackAdvance: 8,
    readValueFromPointer: o
  }, {ignoreDuplicateRegistrations: !0})
}

function __embind_register_std_string(e, r) {
  var t = "std::string" === (r = readLatin1String(r));
  registerType(e, {
    name: r, fromWireType: function (e) {
      var r, n = HEAPU32[e >> 2];
      if (t) for (var o = e + 4, i = 0; i <= n; ++i) {
        var a = e + 4 + i;
        if (i == n || 0 == HEAPU8[a]) {
          var s = a - o, u = UTF8ToString(o, s);
          void 0 === r ? r = u : (r += "\0", r += u), o = a + 1
        }
      } else {
        for (var l = Array(n), i = 0; i < n; ++i) l[i] = String.fromCharCode(HEAPU8[e + 4 + i]);
        r = l.join("")
      }
      return _free(e), r
    }, toWireType: function (e, r) {
      r instanceof ArrayBuffer && (r = new Uint8Array(r));
      var n, o = "string" == typeof r;
      o || r instanceof Uint8Array || r instanceof Uint8ClampedArray || r instanceof Int8Array || throwBindingError("Cannot pass non-string to std::string");
      var i = (n = t && o ? function () {
        return lengthBytesUTF8(r)
      } : function () {
        return r.length
      })(), a = _malloc(4 + i + 1);
      if (HEAPU32[a >> 2] = i, t && o) stringToUTF8(r, a + 4, i + 1); else if (o) for (var s = 0; s < i; ++s) {
        var u = r.charCodeAt(s);
        u > 255 && (_free(a), throwBindingError("String has UTF-16 code units that do not fit in 8 bits")), HEAPU8[a + 4 + s] = u
      } else for (var s = 0; s < i; ++s) HEAPU8[a + 4 + s] = r[s];
      return null !== e && e.push(_free, a), a
    }, argPackAdvance: 8, readValueFromPointer: simpleReadValueFromPointer, destructorFunction: function (e) {
      _free(e)
    }
  })
}

function __embind_register_std_wstring(e, r, t) {
  var n, o, i, a, s;
  t = readLatin1String(t), 2 === r ? (n = UTF16ToString, o = stringToUTF16, a = lengthBytesUTF16, i = function () {
    return HEAPU16
  }, s = 1) : 4 === r && (n = UTF32ToString, o = stringToUTF32, a = lengthBytesUTF32, i = function () {
    return HEAPU32
  }, s = 2), registerType(e, {
    name: t, fromWireType: function (e) {
      for (var t, o = HEAPU32[e >> 2], a = i(), u = e + 4, l = 0; l <= o; ++l) {
        var c = e + 4 + l * r;
        if (l == o || 0 == a[c >> s]) {
          var d = c - u, f = n(u, d);
          void 0 === t ? t = f : (t += "\0", t += f), u = c + r
        }
      }
      return _free(e), t
    }, toWireType: function (e, n) {
      "string" != typeof n && throwBindingError("Cannot pass non-string to C++ string type " + t);
      var i = a(n), u = _malloc(4 + i + r);
      return HEAPU32[u >> 2] = i >> s, o(n, u + 4, i + r), null !== e && e.push(_free, u), u
    }, argPackAdvance: 8, readValueFromPointer: simpleReadValueFromPointer, destructorFunction: function (e) {
      _free(e)
    }
  })
}

function __embind_register_value_object(e, r, t, n, o, i) {
  structRegistrations[e] = {
    name: readLatin1String(r),
    rawConstructor: embind__requireFunction(t, n),
    rawDestructor: embind__requireFunction(o, i),
    fields: []
  }
}

function __embind_register_value_object_field(e, r, t, n, o, i, a, s, u, l) {
  structRegistrations[e].fields.push({
    fieldName: readLatin1String(r),
    getterReturnType: t,
    getter: embind__requireFunction(n, o),
    getterContext: i,
    setterArgumentType: a,
    setter: embind__requireFunction(s, u),
    setterContext: l
  })
}

function __embind_register_void(e, r) {
  r = readLatin1String(r), registerType(e, {
    isVoid: !0, name: r, argPackAdvance: 0, fromWireType: function () {
    }, toWireType: function (e, r) {
    }
  })
}

function _abort() {
  abort()
}

_emscripten_get_now = ENVIRONMENT_IS_NODE ? function () {
  var e = process.hrtime();
  return 1e3 * e[0] + e[1] / 1e6
} : "undefined" != typeof dateNow ? dateNow : function () {
  return performance.now()
};
var _emscripten_get_now_is_monotonic = !0;

function _clock_gettime(e, r) {
  var t;
  if (0 === e) t = Date.now(); else {
    if (1 !== e && 4 !== e || !_emscripten_get_now_is_monotonic) return setErrNo(28), -1;
    t = _emscripten_get_now()
  }
  return HEAP32[r >> 2] = t / 1e3 | 0, HEAP32[r + 4 >> 2] = t % 1e3 * 1e6 | 0, 0
}

function _emscripten_memcpy_big(e, r, t) {
  HEAPU8.copyWithin(e, r, r + t)
}

function _emscripten_get_heap_size() {
  return HEAPU8.length
}

function emscripten_realloc_buffer(e) {
  try {
    return wasmMemory.grow(e - buffer.byteLength + 65535 >>> 16), updateGlobalBufferAndViews(wasmMemory.buffer), 1
  } catch (r) {
  }
}

function _emscripten_resize_heap(e) {
  var r = _emscripten_get_heap_size();
  if (e > 2147483648) return !1;
  for (var t = 1; t <= 4; t *= 2) {
    var n, o = r * (1 + .2 / t);
    if (o = Math.min(o, e + 100663296), emscripten_realloc_buffer(Math.min(2147483648, alignUp(Math.max(e, o), 65536)))) return !0
  }
  return !1
}

function _fd_close(e) {
  try {
    var r = SYSCALLS.getStreamFromFD(e);
    return FS.close(r), 0
  } catch (t) {
    return void 0 !== FS && t instanceof FS.ErrnoError || abort(t), t.errno
  }
}

function _fd_read(e, r, t, n) {
  try {
    var o = SYSCALLS.getStreamFromFD(e), i = SYSCALLS.doReadv(o, r, t);
    return HEAP32[n >> 2] = i, 0
  } catch (a) {
    return void 0 !== FS && a instanceof FS.ErrnoError || abort(a), a.errno
  }
}

function _fd_seek(e, r, t, n, o) {
  try {
    var i = SYSCALLS.getStreamFromFD(e), a = 4294967296 * t + (r >>> 0);
    if (a <= -9007199254740992 || a >= 9007199254740992) return -61;
    return FS.llseek(i, a, n), tempI64 = [i.position >>> 0, (tempDouble = i.position, +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? (0 | Math.min(+Math.floor(tempDouble / 4294967296), 4294967295)) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[o >> 2] = tempI64[0], HEAP32[o + 4 >> 2] = tempI64[1], i.getdents && 0 === a && 0 === n && (i.getdents = null), 0
  } catch (s) {
    return void 0 !== FS && s instanceof FS.ErrnoError || abort(s), s.errno
  }
}

function _fd_write(e, r, t, n) {
  try {
    var o = SYSCALLS.getStreamFromFD(e), i = SYSCALLS.doWritev(o, r, t);
    return HEAP32[n >> 2] = i, 0
  } catch (a) {
    return void 0 !== FS && a instanceof FS.ErrnoError || abort(a), a.errno
  }
}

function _tzset() {
  if (!_tzset.called) {
    _tzset.called = !0;
    var e = (new Date).getFullYear(), r = new Date(e, 0, 1), t = new Date(e, 6, 1), n = r.getTimezoneOffset(),
      o = t.getTimezoneOffset();
    HEAP32[__get_timezone() >> 2] = 60 * Math.max(n, o), HEAP32[__get_daylight() >> 2] = Number(n != o);
    var i = l(r), a = l(t), s = allocateUTF8(i), u = allocateUTF8(a);
    o < n ? (HEAP32[__get_tzname() >> 2] = s, HEAP32[__get_tzname() + 4 >> 2] = u) : (HEAP32[__get_tzname() >> 2] = u, HEAP32[__get_tzname() + 4 >> 2] = s)
  }

  function l(e) {
    var r = e.toTimeString().match(/\(([A-Za-z ]+)\)$/);
    return r ? r[1] : "GMT"
  }
}

function _localtime_r(e, r) {
  _tzset();
  var t = new Date(1e3 * HEAP32[e >> 2]);
  HEAP32[r >> 2] = t.getSeconds(), HEAP32[r + 4 >> 2] = t.getMinutes(), HEAP32[r + 8 >> 2] = t.getHours(), HEAP32[r + 12 >> 2] = t.getDate(), HEAP32[r + 16 >> 2] = t.getMonth(), HEAP32[r + 20 >> 2] = t.getFullYear() - 1900, HEAP32[r + 24 >> 2] = t.getDay();
  var n = new Date(t.getFullYear(), 0, 1), o = (t.getTime() - n.getTime()) / 864e5 | 0;
  HEAP32[r + 28 >> 2] = o, HEAP32[r + 36 >> 2] = -(60 * t.getTimezoneOffset());
  var i = new Date(t.getFullYear(), 6, 1).getTimezoneOffset(), a = n.getTimezoneOffset(),
    s = 0 | (i != a && t.getTimezoneOffset() == Math.min(a, i));
  HEAP32[r + 32 >> 2] = s;
  var u = HEAP32[__get_tzname() + (s ? 4 : 0) >> 2];
  return HEAP32[r + 40 >> 2] = u, r
}

function _mktime(e) {
  _tzset();
  var r = new Date(HEAP32[e + 20 >> 2] + 1900, HEAP32[e + 16 >> 2], HEAP32[e + 12 >> 2], HEAP32[e + 8 >> 2], HEAP32[e + 4 >> 2], HEAP32[e >> 2], 0),
    t = HEAP32[e + 32 >> 2], n = r.getTimezoneOffset(), o = new Date(r.getFullYear(), 0, 1),
    i = new Date(r.getFullYear(), 6, 1).getTimezoneOffset(), a = o.getTimezoneOffset(), s = Math.min(a, i);
  t < 0 ? HEAP32[e + 32 >> 2] = Number(i != a && s == n) : t > 0 != (s == n) && r.setTime(r.getTime() + ((t > 0 ? s : Math.max(a, i)) - n) * 6e4), HEAP32[e + 24 >> 2] = r.getDay();
  var u = (r.getTime() - o.getTime()) / 864e5 | 0;
  return HEAP32[e + 28 >> 2] = u, HEAP32[e >> 2] = r.getSeconds(), HEAP32[e + 4 >> 2] = r.getMinutes(), HEAP32[e + 8 >> 2] = r.getHours(), HEAP32[e + 12 >> 2] = r.getDate(), HEAP32[e + 16 >> 2] = r.getMonth(), r.getTime() / 1e3 | 0
}

function _setTempRet0(e) {
  setTempRet0(0 | e)
}

function _time(e) {
  var r = Date.now() / 1e3 | 0;
  return e && (HEAP32[e >> 2] = r), r
}

var FSNode = function (e, r, t, n) {
  e || (e = this), this.parent = e, this.mount = e.mount, this.mounted = null, this.id = FS.nextInode++, this.name = r, this.mode = t, this.node_ops = {}, this.stream_ops = {}, this.rdev = n
}, readMode = 365, writeMode = 146;

function intArrayFromString(e, r, t) {
  var n = t > 0 ? t : lengthBytesUTF8(e) + 1, o = Array(n), i = stringToUTF8Array(e, o, 0, o.length);
  return r && (o.length = i), o
}

Object.defineProperties(FSNode.prototype, {
  read: {
    get: function () {
      return (this.mode & readMode) === readMode
    }, set: function (e) {
      e ? this.mode |= readMode : this.mode &= ~readMode
    }
  }, write: {
    get: function () {
      return (this.mode & writeMode) === writeMode
    }, set: function (e) {
      e ? this.mode |= writeMode : this.mode &= ~writeMode
    }
  }, isFolder: {
    get: function () {
      return FS.isDir(this.mode)
    }
  }, isDevice: {
    get: function () {
      return FS.isChrdev(this.mode)
    }
  }
}), FS.FSNode = FSNode, FS.staticInit(), InternalError = Module.InternalError = extendError(Error, "InternalError"), embind_init_charCodes(), BindingError = Module.BindingError = extendError(Error, "BindingError"), init_emval(), UnboundTypeError = Module.UnboundTypeError = extendError(Error, "UnboundTypeError");
var asmLibraryArg = {
  r: ___cxa_allocate_exception,
  K: ___cxa_rethrow,
  q: ___cxa_throw,
  k: ___sys_fcntl64,
  E: ___sys_getdents64,
  y: ___sys_ioctl,
  D: ___sys_lstat64,
  C: ___sys_mkdir,
  l: ___sys_open,
  w: ___sys_readlink,
  z: ___sys_rmdir,
  B: ___sys_stat64,
  A: ___sys_unlink,
  s: __embind_finalize_value_object,
  H: __embind_register_bool,
  G: __embind_register_emval,
  m: __embind_register_float,
  g: __embind_register_function,
  b: __embind_register_integer,
  a: __embind_register_memory_view,
  n: __embind_register_std_string,
  e: __embind_register_std_wstring,
  F: __embind_register_value_object,
  j: __embind_register_value_object_field,
  I: __embind_register_void,
  d: _abort,
  J: _clock_gettime,
  u: _emscripten_memcpy_big,
  v: _emscripten_resize_heap,
  c: _fd_close,
  x: _fd_read,
  t: _fd_seek,
  i: _fd_write,
  o: _localtime_r,
  p: _mktime,
  h: _setTempRet0,
  f: _time
}, asm = createWasm(), ___wasm_call_ctors = Module.___wasm_call_ctors = function () {
  return (___wasm_call_ctors = Module.___wasm_call_ctors = Module.asm.M).apply(null, arguments)
}, _malloc = Module._malloc = function () {
  return (_malloc = Module._malloc = Module.asm.N).apply(null, arguments)
}, _free = Module._free = function () {
  return (_free = Module._free = Module.asm.P).apply(null, arguments)
}, ___errno_location = Module.___errno_location = function () {
  return (___errno_location = Module.___errno_location = Module.asm.Q).apply(null, arguments)
}, ___getTypeName = Module.___getTypeName = function () {
  return (___getTypeName = Module.___getTypeName = Module.asm.R).apply(null, arguments)
}, ___embind_register_native_and_builtin_types = Module.___embind_register_native_and_builtin_types = function () {
  return (___embind_register_native_and_builtin_types = Module.___embind_register_native_and_builtin_types = Module.asm.S).apply(null, arguments)
}, __get_tzname = Module.__get_tzname = function () {
  return (__get_tzname = Module.__get_tzname = Module.asm.T).apply(null, arguments)
}, __get_daylight = Module.__get_daylight = function () {
  return (__get_daylight = Module.__get_daylight = Module.asm.U).apply(null, arguments)
}, __get_timezone = Module.__get_timezone = function () {
  return (__get_timezone = Module.__get_timezone = Module.asm.V).apply(null, arguments)
}, dynCall_ji = Module.dynCall_ji = function () {
  return (dynCall_ji = Module.dynCall_ji = Module.asm.W).apply(null, arguments)
}, dynCall_iiji = Module.dynCall_iiji = function () {
  return (dynCall_iiji = Module.dynCall_iiji = Module.asm.X).apply(null, arguments)
}, dynCall_iiij = Module.dynCall_iiij = function () {
  return (dynCall_iiij = Module.dynCall_iiij = Module.asm.Y).apply(null, arguments)
}, dynCall_jiji = Module.dynCall_jiji = function () {
  return (dynCall_jiji = Module.dynCall_jiji = Module.asm.Z).apply(null, arguments)
};

function ExitStatus(e) {
  this.name = "ExitStatus", this.message = "Program terminated with exit(" + e + ")", this.status = e
}

function run(e) {
  if (e = e || arguments_, !(runDependencies > 0)) preRun(), !(runDependencies > 0) && (Module.setStatus ? (Module.setStatus("Running..."), setTimeout(function () {
    setTimeout(function () {
      Module.setStatus("")
    }, 1), r()
  }, 1)) : r());

  function r() {
    !calledRun && (calledRun = !0, Module.calledRun = !0, ABORT || (initRuntime(), preMain(), Module.onRuntimeInitialized && Module.onRuntimeInitialized(), postRun()))
  }
}

if (dependenciesFulfilled = function e() {
  calledRun || run(), calledRun || (dependenciesFulfilled = e)
}, Module.run = run, Module.preInit) for ("function" == typeof Module.preInit && (Module.preInit = [Module.preInit]); Module.preInit.length > 0;) Module.preInit.pop()();
run();