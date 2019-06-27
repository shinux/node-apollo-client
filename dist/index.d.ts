interface IAppInfoProperties {
    configServerUrl: string;
    appId: string | number;
    cluster?: string;
    listenOnNotification?: boolean;
    initialConfigs: {
        [key: string]: object;
    };
}
declare class Apollo {
    configServerUrl: string;
    appId: string | number;
    cluster: string;
    localCachedConfigs: {
        [key: string]: object;
    };
    notifications: {
        [key: string]: number;
    };
    namespaces: string[];
    releaseKeys: {
        [key: string]: string;
    };
    listenOnNotification: boolean;
    errorCount: number;
    private defaultCluster;
    private defaultNamespace;
    private logger;
    constructor(appInfo: IAppInfoProperties);
    /**
     * fetch single config.
     */
    fetchConfig({ key, namespace }: {
        key: string;
        namespace?: string;
    }): any;
    /**
     * fetch multiple configs.
     */
    fetchConfigs({ keys, namespace }: {
        keys: string[];
        namespace?: string;
    }): object;
    /**
     * refresh specific namepace's config partially or all
     *
     * NOTICE: this method will directly merge new configs with exit and do no checks.
     *
     * @param {String} namespace
     * @param {Object} configs
     */
    refreshConfigs(namespace: string | undefined, configs: object): boolean;
    /**
     * this function born to do some initialization operations.
     *
     * i. maintain configs which passed in by constructor.
     * ii. set namespaces property.
     * iii. initialize notifications.
     * iv. initialize releaseKeys.
     *
     */
    private initializeWithConfigs;
    /**
     * Long polling method
     * it recursively requests Apollo server's notification API
     * hangs 60 seconds to simulate an keep-alive connection.
     * if any response get back, it compares result, basically notificationId with local
     * depends on which it fetch latest version of configs directly from Apollo DB
     *
     * then repeat it self.
     */
    private startListenOnNotification;
    /**
     * main config fetcher calls.
     *
     * request Apollo's configfiles API
     *
     * @param {String} namespace
     * @param {Boolean} fromCache - true: fetch from Apollo's Redis /false: fetch from Apollo's MySQL
     */
    private commonConfigFetchAndHandler;
    private fetchConfigsFromCache;
    private fetchConfigsFromDB;
    /**
     * fetch all config from cache as a backup for notification listener.
     *
     * concurrency: 5.
     */
    private fetchKnownNamespace;
    private errorHandler;
}
export default Apollo;
