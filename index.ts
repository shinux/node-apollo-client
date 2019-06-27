import * as Bluebird from "bluebird";
import * as _ from "lodash";
import * as request from "request";

Bluebird.promisifyAll(request);

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

class Apollo {
  public configServerUrl: string;
  public appId: string | number;
  public cluster: string;
  public localCachedConfigs: object;
  public notifications: { [key: string]: number };
  public namespaces: string[];
  public releaseKeys: { [key: string]: string };
  public listenOnNotification: boolean;
  public errorCount: number;

  private defaultCluster = "default";
  private defaultNamespace = "application";
  private logger = (() => {
    return {
      error: (msg) => console.log(`Apollo-client Error: ${msg}`),
      info: (msg) => console.log(`Apollo-client Info: msg`),
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

    this.initializeWithConfigs(appInfo.initialConfigs);

    // high real-time capability
    // long polling which listening on Apollo server's notifications.
    if (this.listenOnNotification && this.notifications) {
      setTimeout(this.startListenOnNotification(), 1e4);
    }

    // low-level real-time capability
    // fetch cached configs from Apollo server
    // fetch once immediately
    this.fetchKnownNamespace();
    // then fetch every 5 minutes
    setInterval(this.fetchKnownNamespace, 5 * 6e4);
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
  public fetchConfigs({ keys, namespace = "application" }: { keys: string[], namespace?: string }): object {
    if (!_.isArray(keys)) {
      this.errorHandler("kyes should be array type");
    }
    return _.pick(_.get(this.localCachedConfigs, `${namespace}`, {}), keys);
  }

  /**
   * refresh specific namepace's config partially or all
   *
   * NOTICE: this method will directly merge new configs with exit and do no checks.
   *
   * @param {String} namespace
   * @param {Object} configs
   */
  public refreshConfigs(namespace: string = "application", configs: object) {
    try {
      if (!namespace || !this.namespaces.includes(namespace)) {
        throw new Error("no such namespace");
      }
      this.localCachedConfigs[namespace] = Object.assign(this.localCachedConfigs[namespace], configs);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * this function born to do some initialization operations.
   *
   * i. maintain configs which passed in by constructor.
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
      this.releaseKeys[key] = null;
    });

  }

  /**
   * Long polling method
   * it recursively requests Apollo server's notification API
   * hangs 60 seconds to simulate an keep-alive connection.
   * if any response get back, it compares result, basically notificationId with local
   * depends on which it fetch latest version of configs directly from Apollo DB
   *
   * then repeat it self.
   */
  private async startListenOnNotification(retryTimes: number = 0) {
    if (!this.listenOnNotification) {
      return;
    }
    const { body, statusCode }: { body: INotificationResponseItem[], statusCode: number } = await request.getAsync({
      json: true,
      timeout: 65,
      uri: `${this.configServerUrl}/notifications/v2?
        appId=${this.appId}&cluster=${this.cluster}&notifications={notifications}`,
    });
    if (statusCode === 304) {
      // nothing updated, won't update.
      return this.startListenOnNotification(0);
    }
    if (body && statusCode === 200) {
      const needToRefetchedNamespaces: { [key: string]: number } = {};
      body.forEach((remoteNotification) => {
        const internalNotificationId: number = _.get(this.notifications, remoteNotification.namespaceName, null);
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
    this.logger.error("error on response");
    return this.startListenOnNotification(retryTimes += 1);
  }

  /**
   * main config fetcher calls.
   *
   * request Apollo's configfiles API
   *
   * @param {String} namespace
   * @param {Boolean} fromCache - true: fetch from Apollo's Redis /false: fetch from Apollo's MySQL
   */
  private async commonConfigFetchAndHandler(namespace: string, fromCache: boolean = true) {
    let uri: string = `${this.configServerUrl}/configfiles/json/${this.appId}/${this.cluster}/${namespace}`;
    if (fromCache && this.releaseKeys[namespace]) {
      uri += `?releaseKey=${this.releaseKeys[namespace]}`;
    }
    const { body, statusCode }: { body: IFetchConfigResponse, statusCode: number } = await request.getAsync({
      json: true,
      uri,
    });
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
      this.logger.error(`mismatch fetching configs ${this.cluster}-${namespace}`);
    }
  }

  private async fetchConfigsFromCache(namespace: string = "application") {
    return await this.commonConfigFetchAndHandler(namespace);
  }

  private async fetchConfigsFromDB(namespace: string = "application") {
    return await this.commonConfigFetchAndHandler(namespace, false);
  }

  /**
   * fetch all config from cache as a backup for notification listener.
   *
   * concurrency: 5.
   */
  private async fetchKnownNamespace() {
    await Bluebird.map(this.namespaces, async (namespace) => {
      await this.fetchConfigsFromCache(namespace);
    }, { concurrency: 5 });
  }

  private errorHandler(errorMessage) {
    this.errorCount += 1;
    throw new Error(errorMessage);
  }
}

export default Apollo;
