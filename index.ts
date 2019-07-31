import * as fs from "fs";
import * as os from "os";

import * as Bluebird from "bluebird";
import * as _ from "lodash";
import * as request from "request";

const requestAsync: any = Bluebird.promisifyAll(request);
const fsAsync: any = Bluebird.promisifyAll(fs);

interface IAppInfoProperties {
  configServerUrl: string;
  appId: string | number;
  cluster?: string;
  listenOnNotification?: boolean;
  namespaces?: string[];
  cachedConfigFilePath?: string;
  initialConfigs?: { [key: string]: object };
  fetchCacheInterval?: number;
}

interface IFetchConfigResponse {
  appId: string | number;
  cluster: string;
  namespaceName: string;
  releaseKey?: string;
  configurations: object;
}

interface INotificationResponseItem {
  namespaceName: string;
  notificationId: number;
  messages?: object;
}

interface IFileConfigInterface {
  appId: string;
  configServerUrl: string;
  cluster: string;
  releaseKeys: { [key: string]: string };
  configs: { [key: string]: object };
  notifications: { [key: string]: number };
}

function sleep(ms: number) {
  return new Bluebird((resolve) => {
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
class Apollo {
  public configServerUrl: string;
  public appId: string | number;
  public cluster: string;
  public localCachedConfigs: { [key: string]: object };
  public notifications: { [key: string]: number };
  public namespaces: Set<string>;
  public listenOnNotification: boolean;
  public errorCount: number;
  public cachedConfigFilePath: string | null;
  public fetchCacheInterval: number;
  public cachedConfigFileName: string;

  private releaseKeys: { [key: string]: string };
  private defaultCluster = "default";
  private defaultNamespace = "application";
  private cachedConfigFileNameSuffix = "nodeApolloCachedConfig.json";
  private logger: any = [ "error", "info", "warn" ].reduce((result: { [key: string]: any }, level: string) => {
    const levelFormater = level.charAt(0).toUpperCase() + level.slice(1);
    result[level] = (msg: string): void => console.log(`[${levelFormater}] Apollo-client: ${msg}`);
    return result;
  }, {});

  constructor(appInfo: IAppInfoProperties) {
    this.configServerUrl = _.get(appInfo, "configServerUrl") || "";
    this.appId = _.get(appInfo, "appId", "");
    this.cluster = _.get(appInfo, "cluster", this.defaultCluster);
    this.cachedConfigFileName = this.appId + "-" + this.cachedConfigFileNameSuffix;
    this.cachedConfigFilePath = _.get(appInfo, "cachedConfigFilePath", os.tmpdir() + "/");
    this.localCachedConfigs = _.get(appInfo, "initialConfigs", { [this.defaultNamespace]: {} });
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
      setTimeout(() => this.startListenOnNotification(), 10e3);
    }

    // load from file
    this.loadFromConfigFile();

    // fetch DB configs from Apollo server at once
    setTimeout(() => this.fetchKnownNamespaceFromDB(), 1e3);

    // low-level real-time capability
    // then fetch every 5 minutes
    setInterval(this.fetchKnownNamespaceFromCache.bind(this), this.fetchCacheInterval);
  }

  /**
   * fetch single config.
   */
  public async fetchConfig({ key, namespace = "application" }: { key: string, namespace?: string }): Bluebird<any> {
    if (!this.releaseKeys[namespace]) {
      await sleep(5000);
    }
    return _.get(this.localCachedConfigs, `${namespace}.${key}`, "");
  }

  /**
   * fetch multiple configs.
   */
  public async fetchConfigs({ keys, namespace = "application" }: { keys: string[], namespace?: string })
    : Bluebird<object> {
    if (!_.isArray(keys)) {
      this.errorHandler("kyes should be array type");
    }
    if (!this.releaseKeys[namespace]) {
      await sleep(5000);
    }
    return _.pick(_.get(this.localCachedConfigs, `${namespace}`, {}), keys);
  }

  /**
   * refresh specific namepace's config partially or completely
   *
   * NOTICE: this method will directly merge new configs with exist and do no checks.
   *
   * @param {String} namespace
   * @param {Object} configs
   */
  public refreshConfigs({ configs, namespace = "application" }: { configs: object, namespace: string }): boolean {
    try {
      if (!namespace || !this.namespaces.has(namespace)) {
        throw new Error("no such namespace");
      }
      this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], configs);
      this.saveConfigFile();
      return true;
    } catch (err) {
      return false;
    }
  }

  private readFromConfigFile(): IFileConfigInterface | null {
    try {
      const jsonFile = fsAsync.readFileSync(this.cachedConfigFilePath + this.cachedConfigFileName, "utf8");
      return JSON.parse(jsonFile);
    } catch (err) {
      this.logger.error(err);
      return null;
    }
  }

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
  private async saveConfigFile(): Bluebird<boolean> {
    try {
      const fileExist = fsAsync.existsSync(this.cachedConfigFilePath + this.cachedConfigFileName);
      let configsToWriteDown = this.localCachedConfigs;
      // try to update base on current appId and cluster
      if (fileExist) {
        const oldConfigs: IFileConfigInterface | null = this.readFromConfigFile();
        if (oldConfigs && oldConfigs.appId === this.appId
          && oldConfigs.cluster === this.cluster && oldConfigs.configServerUrl === this.configServerUrl) {
          configsToWriteDown = Object.assign(oldConfigs.configs, configsToWriteDown);
        }
      }
      const configStringToWriteDown: string = JSON.stringify({
        appId: this.appId,
        cluster: this.cluster,
        configServerUrl: this.configServerUrl,
        configs: configsToWriteDown,
        notifications: this.notifications,
        releaseKeys: this.releaseKeys,
      });
      await fsAsync.writeFileAsync(this.cachedConfigFilePath + this.cachedConfigFileName, configStringToWriteDown);
      return true;
    } catch (err) {
      this.logger.error(err);
      return false;
    }
  }

  private loadFromConfigFile() {
    const oldInfos = this.readFromConfigFile();
    if (!oldInfos) {
      this.logger.error("load configs from configs failed");
      return;
    } else if (oldInfos.appId !== this.appId || oldInfos.cluster !== this.cluster
      || oldInfos.configServerUrl !== this.configServerUrl) {
      this.logger.error("Ain't find no matched config files");
      return;
    } else {
      this.localCachedConfigs = oldInfos.configs;
      this.releaseKeys = oldInfos.releaseKeys;
      this.notifications = Object.assign(this.notifications, oldInfos.notifications);

    }
  }

  /**
   * this function born to do some initialization operations.
   *
   * i. maintain namespaces that passed in by constructor or come from configs.
   * ii. initialize notifications.
   * iii. initialize releaseKeys.
   */
  private initializeNamespaces() {
    Object.keys(this.localCachedConfigs).forEach((key) => {
      this.namespaces.add(key);
    });

    this.namespaces.forEach((namespace) => {
      if (!this.localCachedConfigs[namespace]) {
        this.localCachedConfigs[namespace] = {};
      }
    });

    this.namespaces.forEach((key) => {
      this.notifications[key] = -1;
    });

    this.namespaces.forEach((key) => {
      this.releaseKeys[key] = "";
    });
  }

  /**
   * Long polling method
   * recursively request Apollo server's notification API
   * hangs 60 seconds to simulate an keep-alive connection.
   * if any response get back, it compares result, basically notificationId with local
   * depends on which it fetch latest version of configs directly from Apollo DB
   *
   * then repeat it self.
   */
  private async startListenOnNotification(retryTimes: number = 0): Bluebird<any> {
    if (!this.listenOnNotification) {
      return;
    }
    // delay 10 seonds after failure
    if (retryTimes > 0) {
      await sleep(10e3);
    }
    try {
      const notifications = encodeURIComponent(JSON.stringify(Object.keys(this.notifications).map((namespace) => {
        return { namespaceName: namespace, notificationId: this.notifications[namespace] };
      })));
      const response
        : { body: INotificationResponseItem[], statusCode: number } = await requestAsync.getAsync({
        json: true,
        timeout: 65 * 1e3,
        uri: `${this.configServerUrl}/notifications/v2?` +
          `appId=${this.appId}&cluster=${this.cluster}&notifications=${notifications}`,
      });
      const { body, statusCode } = response;
      if (statusCode === 304) {
        // nothing updated, won't update.
        return await this.startListenOnNotification(0);
      }
      if (body && statusCode === 200) {
        const needToRefetchedNamespaces: { [key: string]: number } = {};
        body.forEach((remoteNotification) => {
          const internalNotificationId: number = _.get(this.notifications, remoteNotification.namespaceName, 0);
          if (internalNotificationId !== remoteNotification.notificationId) {
            needToRefetchedNamespaces[remoteNotification.namespaceName] = remoteNotification.notificationId;
          }
        });
        this.logger.info("notification updated, start fetching new configs...");
        await Bluebird.map(Object.keys(needToRefetchedNamespaces), async (namespace) => {
          await this.fetchConfigsFromDB(namespace);
          // update notification is after fetching and updating configs successfully.
          this.notifications[namespace] = needToRefetchedNamespaces[namespace];
        });
        await this.saveConfigFile();
        return await this.startListenOnNotification(0);
      } else {
        throw new Error(`statusCode: ${statusCode}, body: ${body}`);
      }
    } catch (err) {
      this.logger.error(`error on notificaiotn response: , ${err || ""}`);
      return await this.startListenOnNotification(retryTimes += 1);
    }
  }

  /**
   * fetch from Apollo's Redis
   */
  private async fetchConfigsFromCache(namespace: string = "application") {
    this.logger.info("start fetching from apollo cache...");
    const uri: string = `${this.configServerUrl}/configfiles/json/${this.appId}/${this.cluster}/${namespace}`;
    try {
      const response: { body: object, statusCode: number } = await requestAsync.getAsync({
        json: true,
        uri,
      });
      const { body, statusCode } = response;
      if (!body || statusCode > 200) {
        return this.errorHandler("error on fetching configs from cache");
      }
      if (body && typeof body === "object") {
        this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], body);
        await this.saveConfigFile();
      }
    } catch (err) {
      this.logger.error(`error on fetching config from cache response: , ${err || ""}`);
    }
  }

  /**
   * fetch from Apollo's MySQL
   */
  private async fetchConfigsFromDB(namespace: string = "application") {
    this.logger.info("start fetching from apollo DB...");
    let uri: string = `${this.configServerUrl}/configs/${this.appId}/${this.cluster}/${namespace}`;
    if (this.releaseKeys[namespace]) {
      uri += `?releaseKey=${this.releaseKeys[namespace]}`;
    }
    const response: { body: IFetchConfigResponse, statusCode: number } = await requestAsync.getAsync({
      json: true,
      uri,
    });
    const { body, statusCode } = response;
    if (statusCode === 304) {
      // nothing updated, won't update.
      return;
    }
    if (!body || statusCode > 200) {
      // TODO: retry ?
      this.logger.error(`error on fetch from DB response: ${statusCode} | ${body}`);
    }

    if (body.appId === this.appId
      && body.cluster === this.cluster
      && body.namespaceName === namespace) {
      if (body.releaseKey) {
        this.releaseKeys[namespace] = body.releaseKey;
      }
      if (body.configurations) {
        this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], body.configurations);
        await this.saveConfigFile();
      }
    } else {
      this.errorHandler(`mismatch fetching configs ${this.cluster}-${namespace}`);
    }
  }

  /**
   * fetch all config from cache as a backup for notification listener.
   *
   * concurrency: 5.
   */
  private async fetchKnownNamespaceFromCache() {
    await Bluebird.map(this.namespaces, async (namespace) => {
      await this.fetchConfigsFromCache(namespace);
    }, { concurrency: 5 });
  }

  /**
   * fetch all config from DB at once.
   *
   * concurrency: 5.
   */
  private async fetchKnownNamespaceFromDB() {
    await Bluebird.map(this.namespaces, async (namespace) => {
      await this.fetchConfigsFromDB(namespace);
    }, { concurrency: 5 });
  }

  private errorHandler(errorMessage: string) {
    this.errorCount += 1;
    this.logger.error(errorMessage);
    throw new Error(errorMessage);
  }
}

module.exports = Apollo;
