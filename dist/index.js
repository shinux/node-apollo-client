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
var Bluebird = require("bluebird");
var _ = require("lodash");
var request = require("request");
var requestAsync = Bluebird.promisifyAll(request);
function sleep(ms) {
    return new Bluebird(function (resolve) {
        setTimeout(resolve, ms);
    });
}
var Apollo = /** @class */ (function () {
    function Apollo(appInfo) {
        var _a;
        var _this = this;
        this.defaultCluster = "default";
        this.defaultNamespace = "application";
        this.logger = (function () {
            return {
                error: function (msg) { return console.log("Apollo-client Error: " + msg); },
                info: function (msg) { return console.log("Apollo-client Info: msg"); },
            };
        })();
        this.configServerUrl = _.get(appInfo, "configServerUrl");
        this.appId = _.get(appInfo, "appId");
        this.cluster = _.get(appInfo, "cluster", this.defaultCluster);
        this.localCachedConfigs = {};
        this.notifications = {};
        this.namespaces = [];
        this.releaseKeys = {};
        this.listenOnNotification = _.get(appInfo, "listenOnNotification", true);
        this.errorCount = 0;
        this.initializeWithConfigs(_.get(appInfo, "initialConfigs", (_a = {}, _a[this.defaultNamespace] = {}, _a)));
        if (!this.configServerUrl || !this.appId) {
            this.errorHandler("configServerUrl and appId are required");
            return;
        }
        // high real-time capability
        // long polling which listening on Apollo server's notifications.
        if (this.listenOnNotification && this.notifications) {
            setTimeout(function () { return _this.startListenOnNotification(); }, 10e3);
        }
        // low-level real-time capability
        // fetch cached configs from Apollo server
        // fetch once immediately
        this.fetchKnownNamespace();
        // then fetch every 5 minutes
        setInterval(this.fetchKnownNamespace, 5 * 60e3);
    }
    /**
     * fetch single config.
     */
    Apollo.prototype.fetchConfig = function (_a) {
        var key = _a.key, _b = _a.namespace, namespace = _b === void 0 ? "application" : _b;
        return _.get(this.localCachedConfigs, namespace + "." + key, "");
    };
    /**
     * fetch multiple configs.
     */
    Apollo.prototype.fetchConfigs = function (_a) {
        var keys = _a.keys, _b = _a.namespace, namespace = _b === void 0 ? "application" : _b;
        if (!_.isArray(keys)) {
            this.errorHandler("kyes should be array type");
        }
        return _.pick(_.get(this.localCachedConfigs, "" + namespace, {}), keys);
    };
    /**
     * refresh specific namepace's config partially or all
     *
     * NOTICE: this method will directly merge new configs with exit and do no checks.
     *
     * @param {String} namespace
     * @param {Object} configs
     */
    Apollo.prototype.refreshConfigs = function (_a) {
        var configs = _a.configs, _b = _a.namespace, namespace = _b === void 0 ? "application" : _b;
        try {
            if (!namespace || !this.namespaces.includes(namespace)) {
                throw new Error("no such namespace");
            }
            this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], configs);
            return true;
        }
        catch (err) {
            return false;
        }
    };
    /**
     * this function born to do some initialization operations.
     *
     * i. maintain configs which passed in by constructor.
     * ii. set namespaces property.
     * iii. initialize notifications.
     * iv. initialize releaseKeys.
     *
     */
    Apollo.prototype.initializeWithConfigs = function (currentConfigs) {
        var _a;
        var _this = this;
        if (!currentConfigs || _.isEmpty(currentConfigs)) {
            this.localCachedConfigs = (_a = {},
                _a[this.defaultNamespace] = {},
                _a);
        }
        else {
            this.localCachedConfigs = currentConfigs;
        }
        this.namespaces = Object.keys(this.localCachedConfigs);
        this.namespaces.forEach(function (key) {
            _this.notifications[key] = 0;
        });
        this.namespaces.forEach(function (key) {
            _this.releaseKeys[key] = "";
        });
    };
    /**
     * Long polling method
     * it recursively requests Apollo server's notification API
     * hangs 60 seconds to simulate an keep-alive connection.
     * if any response get back, it compares result, basically notificationId with local
     * depends on which it fetch latest version of configs directly from Apollo DB
     *
     * then repeat it self.
     */
    Apollo.prototype.startListenOnNotification = function (retryTimes) {
        if (retryTimes === void 0) { retryTimes = 0; }
        return __awaiter(this, void 0, Bluebird, function () {
            var response, body, statusCode, needToRefetchedNamespaces_1, err_1;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.listenOnNotification) {
                            return [2 /*return*/];
                        }
                        if (!(retryTimes > 0)) return [3 /*break*/, 2];
                        return [4 /*yield*/, sleep(10e3)];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 6, , 7]);
                        return [4 /*yield*/, requestAsync.getAsync({
                                json: true,
                                timeout: 65,
                                uri: this.configServerUrl + "/notifications/v2?\n          appId=" + this.appId + "&cluster=" + this.cluster + "&notifications={notifications}",
                            })];
                    case 3:
                        response = _a.sent();
                        body = response.body, statusCode = response.statusCode;
                        if (statusCode === 304) {
                            // nothing updated, won't update.
                            return [2 /*return*/, this.startListenOnNotification(0)];
                        }
                        if (!(body && statusCode === 200)) return [3 /*break*/, 5];
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
                    case 4:
                        _a.sent();
                        return [2 /*return*/, this.startListenOnNotification(0)];
                    case 5: throw new Error();
                    case 6:
                        err_1 = _a.sent();
                        this.logger.error("error on notificaiotn response");
                        return [2 /*return*/, this.startListenOnNotification(retryTimes += 1)];
                    case 7: return [2 /*return*/];
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
            var uri, response, body, statusCode;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        uri = this.configServerUrl + "/configfiles/json/" + this.appId + "/" + this.cluster + "/" + namespace;
                        return [4 /*yield*/, requestAsync.getAsync({
                                json: true,
                                uri: uri,
                            })];
                    case 1:
                        response = _a.sent();
                        body = response.body, statusCode = response.statusCode;
                        if (!body || statusCode > 200) {
                            return [2 /*return*/, this.errorHandler("error on fetching configs from cache")];
                        }
                        if (body && typeof body === "object") {
                            this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], body);
                        }
                        return [2 /*return*/];
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
                            this.logger.error("error on response");
                        }
                        if (body.appId === this.appId
                            && body.cluster === this.cluster
                            && body.namespaceName === namespace) {
                            if (body.releaseKey) {
                                this.releaseKeys[namespace] = body.releaseKey;
                            }
                            if (body.configurations) {
                                this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], body.configurations);
                            }
                        }
                        else {
                            this.errorHandler("mismatch fetching configs " + this.cluster + "-" + namespace);
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * fetch all config from cache as a backup for notification listener.
     *
     * concurrency: 5.
     */
    Apollo.prototype.fetchKnownNamespace = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Bluebird.map(this.namespaces, function (namespace) { return __awaiter(_this, void 0, void 0, function () {
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
                        return [2 /*return*/];
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