"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var os = require("os");
var path = require("path");
var Bluebird = require("bluebird");
var _ = require("lodash");
var request = require("request");
var requestAsync = Bluebird.promisifyAll(request);
var fsAsync = Bluebird.promisifyAll(fs);
function sleep(ms) {
    return new Bluebird(function (resolve) {
        setTimeout(resolve, ms);
    });
}
/**
 * i. save and read local cached config file from `cachedConfigFilePath`
 * ii. fetch Apollo config from DB at once
 * iii. fetch Apollo config from cache periodically
 * iv. subscribe notificatin by long polling which simulate keep alive connection
 * v. everytime new config get back, update local cached file.
 */
var Apollo = /** @class */ (function () {
    function Apollo(appInfo) {
        var _a;
        var _this = this;
        this.defaultCluster = "default";
        this.defaultNamespace = "application";
        this.cachedConfigFileNameSuffix = "nodeApolloCachedConfig.json";
        this.logger = ["error", "info", "warn"].reduce(function (result, level) {
            var levelFormater = level.charAt(0).toUpperCase() + level.slice(1);
            result[level] = function (msg) { return console.log("[" + levelFormater + "] Apollo-client: " + msg); };
            return result;
        }, {});
        this.configServerUrl = _.get(appInfo, "configServerUrl") || "";
        this.appId = _.get(appInfo, "appId", "");
        this.cluster = _.get(appInfo, "cluster", this.defaultCluster);
        this.cachedConfigFileName = this.appId + "-" + this.cachedConfigFileNameSuffix;
        this.cachedConfigFilePath = path.join(_.get(appInfo, "cachedConfigFilePath", os.tmpdir()), this.cachedConfigFileName);
        this.localCachedConfigs = _.get(appInfo, "initialConfigs", (_a = {}, _a[this.defaultNamespace] = {}, _a));
        this.notifications = {};
        this.namespaces = new Set(_.get(appInfo, "namespaces", ["application"]));
        this.fetchCacheInterval = _.get(appInfo, "fetchCacheInterval", 5 * 60e3);
        this.releaseKeys = {};
        this.listenOnNotification = _.get(appInfo, "listenOnNotification", true);
        this.errorCount = 0;
        this.initializeNamespaces();
        if (!this.configServerUrl || !this.appId) {
            this.errorHandler("configServerUrl and appId are required");
            return;
        }
        if (this.fetchCacheInterval && this.fetchCacheInterval < 1 * 30e3) {
            this.errorHandler("fetchCacheInterval too short");
            return;
        }
        // high real-time capability
        // long polling which listening on Apollo server's notifications.
        if (this.listenOnNotification && this.notifications) {
            setTimeout(function () { return _this.startListenOnNotification(); }, 10e3);
        }
        // load from file
        this.loadFromConfigFile();
        // fetch DB configs from Apollo server at once
        setTimeout(function () { return _this.fetchKnownNamespaceFromDB(); }, 1e3);
        // low-level real-time capability
        // then fetch every 5 minutes
        setInterval(this.fetchKnownNamespaceFromCache.bind(this), this.fetchCacheInterval);
    }
    /**
     * fetch single config.
     */
    Apollo.prototype.fetchConfig = function (_a) {
        var key = _a.key, _b = _a.namespace, namespace = _b === void 0 ? "application" : _b;
        return __awaiter(this, void 0, Bluebird, function () {
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        if (!!this.releaseKeys[namespace]) return [3 /*break*/, 2];
                        return [4 /*yield*/, sleep(5000)];
                    case 1:
                        _c.sent();
                        _c.label = 2;
                    case 2: return [2 /*return*/, _.get(this.localCachedConfigs, namespace + "." + key, "")];
                }
            });
        });
    };
    /**
     * fetch multiple configs.
     */
    Apollo.prototype.fetchConfigs = function (_a) {
        var keys = _a.keys, _b = _a.namespace, namespace = _b === void 0 ? "application" : _b;
        return __awaiter(this, void 0, Bluebird, function () {
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        if (!_.isArray(keys)) {
                            this.errorHandler("kyes should be array type");
                        }
                        if (!!this.releaseKeys[namespace]) return [3 /*break*/, 2];
                        return [4 /*yield*/, sleep(5000)];
                    case 1:
                        _c.sent();
                        _c.label = 2;
                    case 2: return [2 /*return*/, _.pick(_.get(this.localCachedConfigs, "" + namespace, {}), keys)];
                }
            });
        });
    };
    /**
     * refresh specific namepace's config partially or completely
     *
     * NOTICE: this method will directly merge new configs with exist and do no checks.
     *
     * @param {String} namespace
     * @param {Object} configs
     */
    Apollo.prototype.refreshConfigs = function (_a) {
        var configs = _a.configs, _b = _a.namespace, namespace = _b === void 0 ? "application" : _b;
        try {
            if (!namespace || !this.namespaces.has(namespace)) {
                throw new Error("no such namespace");
            }
            this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], configs);
            this.saveConfigFile();
            return true;
        }
        catch (err) {
            return false;
        }
    };
    Apollo.prototype.readFromConfigFile = function () {
        try {
            var jsonFile = fsAsync.readFileSync(this.cachedConfigFilePath, "utf8");
            return JSON.parse(jsonFile);
        }
        catch (err) {
            this.logger.error(err);
            return null;
        }
    };
    /**
     * update and save config file.
     *
     * config file format:
     * {
     *   appId,
     *   cluster,
     *   config: {
     *     namespace1: {
     *     }
     *     namespace2: {
     *     }
     *   },
     *   notifications,
     * }
     */
    Apollo.prototype.saveConfigFile = function () {
        return __awaiter(this, void 0, Bluebird, function () {
            var fileExist, configsToWriteDown, oldConfigs, configStringToWriteDown, err_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        fileExist = fsAsync.existsSync(this.cachedConfigFilePath);
                        configsToWriteDown = this.localCachedConfigs;
                        // try to update base on current appId and cluster
                        if (fileExist) {
                            oldConfigs = this.readFromConfigFile();
                            if (oldConfigs && oldConfigs.appId === this.appId
                                && oldConfigs.cluster === this.cluster && oldConfigs.configServerUrl === this.configServerUrl) {
                                configsToWriteDown = Object.assign(oldConfigs.configs, configsToWriteDown);
                            }
                        }
                        configStringToWriteDown = JSON.stringify({
                            appId: this.appId,
                            cluster: this.cluster,
                            configServerUrl: this.configServerUrl,
                            configs: configsToWriteDown,
                            notifications: this.notifications,
                            releaseKeys: this.releaseKeys,
                        });
                        return [4 /*yield*/, fsAsync.writeFileAsync(this.cachedConfigFilePath, configStringToWriteDown)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, true];
                    case 2:
                        err_1 = _a.sent();
                        this.logger.error(err_1);
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    Apollo.prototype.loadFromConfigFile = function () {
        var oldInfos = this.readFromConfigFile();
        if (!oldInfos) {
            this.logger.error("load configs from config files failed");
            return;
        }
        else if (oldInfos.appId !== this.appId || oldInfos.cluster !== this.cluster
            || oldInfos.configServerUrl !== this.configServerUrl) {
            this.logger.error("Ain't find no matched config files");
            return;
        }
        else {
            this.localCachedConfigs = oldInfos.configs;
            this.releaseKeys = oldInfos.releaseKeys;
            this.notifications = Object.assign(this.notifications, oldInfos.notifications);
        }
    };
    /**
     * this function born to do some initialization operations.
     *
     * i. maintain namespaces that passed in by constructor or come from configs.
     * ii. initialize notifications.
     * iii. initialize releaseKeys.
     */
    Apollo.prototype.initializeNamespaces = function () {
        var _this = this;
        Object.keys(this.localCachedConfigs).forEach(function (key) {
            _this.namespaces.add(key);
        });
        this.namespaces.forEach(function (namespace) {
            if (!_this.localCachedConfigs[namespace]) {
                _this.localCachedConfigs[namespace] = {};
            }
        });
        this.namespaces.forEach(function (key) {
            _this.notifications[key] = -1;
        });
        this.namespaces.forEach(function (key) {
            _this.releaseKeys[key] = "";
        });
    };
    Apollo.prototype.requestNotification = function () {
        return __awaiter(this, void 0, void 0, function () {
            var notifications, response, body, statusCode, needToRefetchedNamespaces_1;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        notifications = encodeURIComponent(JSON.stringify(Object.keys(this.notifications).map(function (namespace) {
                            return { namespaceName: namespace, notificationId: _this.notifications[namespace] };
                        })));
                        return [4 /*yield*/, requestAsync.getAsync({
                                json: true,
                                timeout: 65 * 1e3,
                                uri: this.configServerUrl + "/notifications/v2?" +
                                    ("appId=" + this.appId + "&cluster=" + this.cluster + "&notifications=" + notifications),
                            })];
                    case 1:
                        response = _a.sent();
                        body = response.body, statusCode = response.statusCode;
                        if (statusCode === 304) {
                            // nothing updated, won't update.
                            return [2 /*return*/];
                        }
                        if (!(body && statusCode === 200)) return [3 /*break*/, 4];
                        needToRefetchedNamespaces_1 = {};
                        body.forEach(function (remoteNotification) {
                            var internalNotificationId = _.get(_this.notifications, remoteNotification.namespaceName, 0);
                            if (internalNotificationId !== remoteNotification.notificationId) {
                                needToRefetchedNamespaces_1[remoteNotification.namespaceName] = remoteNotification.notificationId;
                            }
                        });
                        return [4 /*yield*/, Bluebird.map(Object.keys(needToRefetchedNamespaces_1), function (namespace) { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, this.fetchConfigsFromDB(namespace)];
                                        case 1:
                                            _a.sent();
                                            // update notification is after fetching and updating configs successfully.
                                            this.notifications[namespace] = needToRefetchedNamespaces_1[namespace];
                                            return [2 /*return*/];
                                    }
                                });
                            }); })];
                    case 2:
                        _a.sent();
                        return [4 /*yield*/, this.saveConfigFile()];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4: throw new Error("statusCode: " + statusCode + ", body: " + body);
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Long polling method
     * recursively request Apollo server's notification API
     * hangs 60 seconds to simulate an keep-alive connection.
     * if any response get back, it compares result, basically notificationId with local
     * depends on which it fetch latest version of configs directly from Apollo DB
     *
     * then repeat it self.
     */
    Apollo.prototype.startListenOnNotification = function () {
        return __awaiter(this, void 0, Bluebird, function () {
            var retryTimes, err_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.listenOnNotification) {
                            return [2 /*return*/];
                        }
                        retryTimes = 0;
                        _a.label = 1;
                    case 1:
                        if (!this.listenOnNotification) return [3 /*break*/, 7];
                        if (!(retryTimes >= 5)) return [3 /*break*/, 3];
                        return [4 /*yield*/, sleep(10e3)];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 5, , 6]);
                        return [4 /*yield*/, this.requestNotification()];
                    case 4:
                        _a.sent();
                        retryTimes = 0;
                        return [3 /*break*/, 6];
                    case 5:
                        err_2 = _a.sent();
                        this.logger.error("error on notificaiotn response: , " + (err_2 || ""));
                        retryTimes += 1;
                        return [3 /*break*/, 6];
                    case 6: return [3 /*break*/, 1];
                    case 7:
                        if (!(retryTimes > 0)) return [3 /*break*/, 9];
                        return [4 /*yield*/, sleep(10e3)];
                    case 8:
                        _a.sent();
                        _a.label = 9;
                    case 9: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * fetch from Apollo's Redis
     */
    Apollo.prototype.fetchConfigsFromCache = function (namespace) {
        if (namespace === void 0) { namespace = "application"; }
        return __awaiter(this, void 0, void 0, function () {
            var uri, response, body, statusCode, err_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.logger.info("start fetching from apollo cache...");
                        uri = this.configServerUrl + "/configfiles/json/" + this.appId + "/" + this.cluster + "/" + namespace;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 5, , 6]);
                        return [4 /*yield*/, requestAsync.getAsync({
                                json: true,
                                uri: uri,
                            })];
                    case 2:
                        response = _a.sent();
                        body = response.body, statusCode = response.statusCode;
                        if (!body || statusCode > 200) {
                            return [2 /*return*/, this.errorHandler("error on fetching configs from cache")];
                        }
                        if (!(body && typeof body === "object")) return [3 /*break*/, 4];
                        this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], body);
                        return [4 /*yield*/, this.saveConfigFile()];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        err_3 = _a.sent();
                        this.logger.error("error on fetching config from cache response: , " + (err_3 || ""));
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * fetch from Apollo's MySQL
     */
    Apollo.prototype.fetchConfigsFromDB = function (namespace) {
        if (namespace === void 0) { namespace = "application"; }
        return __awaiter(this, void 0, void 0, function () {
            var uri, response, body, statusCode;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.logger.info("start fetching from apollo DB...");
                        uri = this.configServerUrl + "/configs/" + this.appId + "/" + this.cluster + "/" + namespace;
                        if (this.releaseKeys[namespace]) {
                            uri += "?releaseKey=" + this.releaseKeys[namespace];
                        }
                        return [4 /*yield*/, requestAsync.getAsync({
                                json: true,
                                uri: uri,
                            })];
                    case 1:
                        response = _a.sent();
                        body = response.body, statusCode = response.statusCode;
                        if (statusCode === 304) {
                            // nothing updated, won't update.
                            return [2 /*return*/];
                        }
                        if (!body || statusCode > 200) {
                            // TODO: retry ?
                            this.logger.error("error on fetch from DB response: " + statusCode + " | " + body);
                        }
                        if (!(body.appId === this.appId
                            && body.cluster === this.cluster
                            && body.namespaceName === namespace)) return [3 /*break*/, 4];
                        if (body.releaseKey) {
                            this.releaseKeys[namespace] = body.releaseKey;
                        }
                        if (!body.configurations) return [3 /*break*/, 3];
                        this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], body.configurations);
                        return [4 /*yield*/, this.saveConfigFile()];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3: return [3 /*break*/, 5];
                    case 4:
                        this.errorHandler("mismatch fetching configs " + this.cluster + "-" + namespace);
                        _a.label = 5;
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * fetch all config from cache as a backup for notification listener.
     *
     * concurrency: 5.
     */
    Apollo.prototype.fetchKnownNamespaceFromCache = function () {
        return __awaiter(this, void 0, void 0, function () {
            var err_4;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, Bluebird.map(this.namespaces, function (namespace) { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, this.fetchConfigsFromCache(namespace)];
                                        case 1:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); }, { concurrency: 5 })];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        err_4 = _a.sent();
                        this.logger.error(err_4);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * fetch all config from DB at once.
     *
     * concurrency: 5.
     */
    Apollo.prototype.fetchKnownNamespaceFromDB = function () {
        return __awaiter(this, void 0, void 0, function () {
            var err_5;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, Bluebird.map(this.namespaces, function (namespace) { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, this.fetchConfigsFromDB(namespace)];
                                        case 1:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); }, { concurrency: 5 })];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        err_5 = _a.sent();
                        this.logger.error(err_5);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    Apollo.prototype.errorHandler = function (errorMessage) {
        this.errorCount += 1;
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
    };
    return Apollo;
}());
module.exports = Apollo;
