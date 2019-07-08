# node-apollo-client [![Build Status][circleci-image]][circleci-url] [![NPM Version][npm-image]][npm-url] ![node](https://img.shields.io/node/v/node-apollo-client.svg?style=flat-square)

[circleci-image]: https://img.shields.io/circleci/build/github/shinux/node-apollo-client.svg?style=popout-square
[circleci-url]: https://circleci.com/gh/shinux/workflows/node-apollo-client

[npm-image]: https://img.shields.io/npm/v/node-apollo-client.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/node-apollo-client



node apollo client for Ctrip Apollo

Features:

1. implement all APIs described in [official documentation]([https://github.com/ctripcorp/apollo/wiki/%E5%85%B6%E5%AE%83%E8%AF%AD%E8%A8%80%E5%AE%A2%E6%88%B7%E7%AB%AF%E6%8E%A5%E5%85%A5%E6%8C%87%E5%8D%97](https://github.com/ctripcorp/apollo/wiki/其它语言客户端接入指南))
2. written in TypeScript and typing support

## client logic and availability

```bash
local configs object
  \-+= fetch from Apollo cache at once
     \-+= fetch from Apollo cache periodically (5 minutes)
        \-+= subscribe notification and fetch from Apollo DB if release tag changed
           \-+= update local configs by API
```

|                                               scene | influence | configs source                               |
| --------------------------------------------------: | --------- | -------------------------------------------- |
|                failed to connect apollo at begining | x         | use local configs directly                   |
|                            failed to connect apollo | x         | use cached apollo configs                    |
| failed to connect apollo and wish to update configs | x         | update cached configs temporarily            |
|                     failed to receive notifications | x         | fetch configs periodically fetch from apollo |
|                   failed to fetch from apollo cache | x         | subscribe notification and fetch from DB     |

## Usage

install package from npm

``` npm install node-apollo-client```


```javascript
const Apollo = require('node-apollo-client')

// Instantiate Apollo
const apollo = new Apollo({
  configServerUrl: 'your-config-server-url',
  appId: 'your-app-id',
  cluster: 'default', // default to `default`
  initialConfigs: {
    application: {  // this is default namespace name
      foo: 'Mars',
      bar: 'Jupiter'
    },
  },
  listenOnNotification: true, // default to true
});

// fetch single config
apollo.fetchConfig({ key: 'foo' });
// return false

// fetch multiple configs
apollo.fetchConfigs({ keys: [ 'foo', 'bar' ] });
// return { foo: 'Mars', bar: 'Jupiter' }

// refresh local configs (merely used when Apollo is unavailable)
apollo.refreshConfigs({ configs: { foo: 'Mercury' } });
// check out key `foo`
apollo.fetchConfig({ key: 'foo' });
// return { foo: 'Mercury' }
```


## License

MIT

