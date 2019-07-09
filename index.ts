import * as Bluebird from "bluebird";
import * as _ from "lodash";
import * as request from "request";

const requestAsync: any = Bluebird.promisifyAll(request);

interface IAppInfoProperties {
  configServerUrl: string;
  appId: string | number;
  cluster?: string;
  listenOnNotification?: boolean;
  initialConfigs: { [key: string]: object };
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

function sleep(ms: number) {
  return new Bluebird((resolve) => {
    setTimeout(resolve, ms);
  });
}

class Apollo {
  public configServerUrl: string;
  public appId: string | number;
  public cluster: string;
  public localCachedConfigs: { [key: string]: object };
  public notifications: { [key: string]: number };
  public namespaces: string[];
  public releaseKeys: { [key: string]: string };
  public listenOnNotification: boolean;
  public errorCount: number;

  private defaultCluster = "default";
  private defaultNamespace = "application";
  private logger = (() => {
    return {
      error: (msg: string) => console.log(`Apollo-client Error: ${msg}`),
      info: (msg: string) => console.log(`Apollo-client Info: ${msg}`),
    };
  })();

  constructor(appInfo: IAppInfoProperties) {
    this.configServerUrl = _.get(appInfo, "configServerUrl");
    this.appId = _.get(appInfo, "appId");
    this.cluster = _.get(appInfo, "cluster", this.defaultCluster);
    this.localCachedConfigs = {};
    this.notifications = {};
    this.namespaces = [];

    this.releaseKeys = {};
    this.listenOnNotification = _.get(appInfo, "listenOnNotification", true);
    this.errorCount = 0;

    this.initializeWithConfigs(_.get(appInfo, "initialConfigs", { [this.defaultNamespace]: {} }));

    if (!this.configServerUrl || !this.appId) {
      this.errorHandler("configServerUrl and appId are required");
      return;
    }

    // high real-time capability
    // long polling which listening on Apollo server's notifications.
    if (this.listenOnNotification && this.notifications) {
      setTimeout(() => this.startListenOnNotification(), 10e3);
    }

    // low-level real-time capability
    // fetch cached configs from Apollo server
    // fetch once immediately
    this.fetchKnownNamespaceFromDB();
    // then fetch every 5 minutes
    setInterval(this.fetchKnownNamespaceFromCache, 5 * 60e3);
  }

  /**
   * fetch single config.
   */
  public fetchConfig({ key, namespace = "application" }: { key: string, namespace?: string }): any {
    return _.get(this.localCachedConfigs, `${namespace}.${key}`, "");
  }

  /**
   * fetch multiple configs.
   */
  public fetchConfigs({ keys, namespace = "application" }: { keys: string[], namespace?: string }): any {
    if (!_.isArray(keys)) {
      this.errorHandler("kyes should be array type");
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
      if (!namespace || !this.namespaces.includes(namespace)) {
        throw new Error("no such namespace");
      }
      this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], configs);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * this function born to do some initialization operations.
   *
   * i. maintain configs that passed in by constructor.
   * ii. set namespaces property.
   * iii. initialize notifications.
   * iv. initialize releaseKeys.
   *
   */
  private initializeWithConfigs(currentConfigs: { [key: string]: object }) {
    if (!currentConfigs || _.isEmpty(currentConfigs)) {
      this.localCachedConfigs = {
        [this.defaultNamespace]: {},
      };
    } else {
      this.localCachedConfigs = currentConfigs;
    }
    this.namespaces = Object.keys(this.localCachedConfigs);
    this.namespaces.forEach((key) => {
      this.notifications[key] = 0;
    });
    this.namespaces.forEach((key) => {
      this.releaseKeys[key] = "";
    });

  }

  /**
   * Long polling method
   * recursively requests Apollo server's notification API
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
      const notificationsForApollo = Object.keys(this.notifications).map((namespace) => {
        return { namespaceName: namespace, notificationId: this.notifications[namespace] };
      });
      const response
        : { body: INotificationResponseItem[], statusCode: number } = await requestAsync.getAsync({
        json: true,
        timeout: 65,
        uri: `${this.configServerUrl}/notifications/v2?
          appId=${this.appId}&cluster=${this.cluster}&notifications=${notificationsForApollo}`,
      });
      const { body, statusCode } = response;
      if (statusCode === 304) {
        // nothing updated, won't update.
        return this.startListenOnNotification(0);
      }
      if (body && statusCode === 200) {
        const needToRefetchedNamespaces: { [key: string]: number } = {};
        body.forEach((remoteNotification) => {
          const internalNotificationId: number = _.get(this.notifications, remoteNotification.namespaceName, 0);
          if (internalNotificationId !== remoteNotification.notificationId) {
            needToRefetchedNamespaces[remoteNotification.namespaceName] = remoteNotification.notificationId;
          }
        });
        await Bluebird.map(Object.keys(needToRefetchedNamespaces), async (namespace) => {
          await this.fetchConfigsFromDB(namespace);
          // update notification is after fetching and updating configs successfully.
          this.notifications[namespace] = needToRefetchedNamespaces[namespace];
        });

        return this.startListenOnNotification(0);
      }
      throw new Error();
    } catch (err) {
      this.logger.error("error on notificaiotn response");
      return this.startListenOnNotification(retryTimes += 1);
    }
  }

  /**
   * fetch from Apollo's Redis
   */
  private async fetchConfigsFromCache(namespace: string = "application") {
    const uri: string = `${this.configServerUrl}/configfiles/json/${this.appId}/${this.cluster}/${namespace}`;
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
    }
  }

  /**
   * fetch from Apollo's MySQL
   */
  private async fetchConfigsFromDB(namespace: string = "application") {
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
