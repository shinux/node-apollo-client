const _ = require('lodash');
const request = require('request');
const Bluebird = require('bluebird');

Bluebird.promisifyAll(request);


const defaultCluster = 'default';
const defaultNamespace = 'application';

const logger = (() => {
  return {
    info: (info) => { console.log(info); },
    error: (err) => { console.log(`Error: ${err}`); },
  };
})();

//{
//  appId
//  (env) configServerUrl
//  cluster (default)
//  namespace (application)
//  initialConfigs: {
//  }
//  fetchInterval (5minutes)
//}
//
//
//
//
class Apollo {
  // TODO: http long polling
  constructor(appInfo) {
    this.configServerUrl = _.get(appInfo, 'configServerUrl');
    this.appId = _.get(appInfo, 'appId');
    this.cluster = _.get(appInfo, 'cluster', defaultCluster);
    this._localCachedConfigs = {};
    this._notifications = {};
    this._namespaces = [];

    this._releaseKey = '';
    this.listenOnNotification = _.get(appInfo, 'listenOnNotification', true);
    this.errorCount = 0;

    this.initializeWithConfigs(appInfo.initialConfigs);

    // 60秒的长轮询，监听配置改动
    if (this.listenOnNotification && this._notifications) {
      setTimeout(this.startListenOnNotification(this._notifications), 10000);
    }

    // 每 2 分钟拿一次缓存数据
    setInterval(() => {
      this._namespaces.forEach((namepspace) => {
        this.fetchConfigsFromCache(namepspace);
      });
    }, 120000);
  }

  /**
   * @private
   */
  initializeWithConfigs(currentConfigs) {
    if (!currentConfigs || _.isEmpty(currentConfigs)) {
      this._localCachedConfigs = {
        [defaultNamespace]: {},
      };
    } else {
      this._localCachedConfigs = currentConfigs;
    }
    const keys = Object.keys(this._localCachedConfigs);
    this._namespaces = keys;
    keys.forEach((key) => {
      this._notifications[key] = null;
    });
  }

  async startListenOnNotification(retryTimes = 0) {
    if (!this.listenOnNotification) {
      return;
    }
    const { body, statusCode } = await request.getAsync({
      uri: `${this.configServerUrl}/notifications/v2?appId=${this.appId}&cluster=${this.cluster}&notifications={notifications}`,
      timeout: 65,
      json: true,
    });
    if (statusCode === 304) {
      // nothing updated, won't update.
      return this.startListenOnNotification(0);
    }
    if (body && statusCode === 200) {
      const needToRefetchedNamespaces = [];
      // 这里注意值的引用和修改，要做得干净点
      body.forEach((remoteNotification) => {
        const internalNotificationId = _.get(this._notifications, remoteNotification.namespaceName, null);
        this._notifications[remoteNotification.namespaceName] = remoteNotification.notificationId;
        if (internalNotificationId && remoteNotification.notificationId) {
          needToRefetchedNamespaces.push(remoteNotification.namespaceName);
        }
      });
      // 分别更新
      await Bluebird.map(needToRefetchedNamespaces, async(namespace) => {
        await this.fetchConfigsFromDB(namespace);
      });
      // 成功，并刷新重试次数为 0
      return this.startListenOnNotification(0);
    }
    // TODO: retry
    logger.error('error on response');
    return this.startListenOnNotification(retryTimes += 1);
  }

  async commonConfigFetchAndHandler({ namespace, fromCache = true }) {
    let uri = `${this.configServerUrl}/configfiles/json/${this.appId}/${this.cluster}/${namespace}`;
    if (fromCache && this._releaseKey) {
      uri += `?releaseKey=${this._releaseKey}`;
    }
    const { body, statusCode } = await request.getAsync({ uri, json: true });
    if (statusCode === 304) {
      // nothing updated, won't update.
      return;
    }
    if (!body || statusCode > 200) {
      // TODO: retry
      logger.error('error on response');
    }
    if (body.appId === this.appId
      && body.cluster === this.cluster
      && body.namespaceName === namespace) {
      if (body.releaseKey) {
        this.releaseKey = body.releaseKey;
      }
      if (body.configurations) {
        this._localCachedConfigs[namespace] = Object.assing(this._localCachedConfigs[namespace], body.configurations);
      }
    } else {
      logger.error(`mismatch fetching configs ${this.cluster}-${namespace}`);
    }
   }

  async fetchConfigsFromCache({ namespace = 'application' }) {
    return await this.commonConfigFetchAndHandler({ namespace });
  }

  async fetchConfigsFromDB({ namespace = 'application' }) {
    return await this.commonConfigFetchAndHandler({ namespace, fromCache: false });
  }

  fetchConfig({ key, namespace = 'application' }) {
    return _.get(this._localCachedConfigs, `${namespace}.${key}`, '');
  }

  fetchConfigs({ keys, namespace = 'application' }) {
    if (!_.isArray(keys)) {
      this.errorHandler('kyes should be array type');
    }
    return _.pick(_.get(this._localCachedConfigs, `${namespace}`, {}), keys);
  }

  errorHandler(errorMessage) {
    this.errorCount += 1;
    throw new Error(errorMessage);
  }
}


module.exports = Apollo;
