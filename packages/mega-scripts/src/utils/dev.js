import { resolve } from 'path';
import {
  dev,
  getUserConfig,
  watchConfigs,
  unwatchConfigs,
} from '@lugia/mega-webpack';
import noopServiceWorkerMiddleware from '@lugia/mega-utils/lib/noopServiceWorkerMiddleware';
import chalk from 'chalk';
import browserSync from 'browser-sync';
import getWebpackConfig from './getWebpackConfig';
import getPaths from './getPaths';
import registerBabel from './registerBabel';
import { applyMock } from './mock';

const debug = require('debug')('@lugia/mega-scripts:dev');

export default function runDev(opts = {}) {
  const { cwd = process.cwd(), entry } = opts;

  const babel = resolve(__dirname, './babel.js');
  const paths = getPaths(cwd);

  // register babel for config files
  registerBabel(babel, {
    cwd,
    configOnly: true,
  });

  let isFirstCompile = true;
  let bs = null;

  function initBrowserSync({
    appName,
    urls,
    cwd,
    disableBrowserSync,
    autoOpenBrowser,
  }) {
    disableBrowserSync =
      process.env.BROWSER_SYNC === 'none' ? true : disableBrowserSync;
    autoOpenBrowser = process.env.BROWSER === 'none' ? false : autoOpenBrowser;

    if (disableBrowserSync || !isFirstCompile) return;

    bs = browserSync.create(appName || undefined);
    bs.init({
      open: autoOpenBrowser,
      // ui: false,
      notify: false,
      proxy: {
        target: urls.localUrlForBrowser,
        ws: true,
      },
      cwd,
      // port: ,
    });

    isFirstCompile = false;
  }

  // get user config
  let config = null;
  let userPKG = null;
  let returnedWatchConfig = null;
  try {
    ({ config, userPKG, watch: returnedWatchConfig } = getUserConfig({ cwd }));
    debug(`user config: ${JSON.stringify(config)}`);
  } catch (e) {
    console.error(chalk.red(e.message));
    debug('Get .webpackrc config failed, watch config and reload');

    // 监听配置项变更，然后重新执行 dev 逻辑
    watchConfigs().on('all', (event, path) => {
      debug(`[${event}] ${path}, unwatch and reload`);
      bs && bs.active && bs.exit(); // eslint-disable-line
      bs = null;
      unwatchConfigs();
      runDev(opts);
    });
    return;
  }

  // get webpack config
  const webpackConfig = getWebpackConfig({
    cwd,
    config,
    babel,
    paths,
    entry,
  });
  const autoOpenBrowser = config.openBrowser || true;

  dev({
    webpackConfig,
    userPKG,
    autoOpenBrowser,
    index: config.html && config.html.filename,
    port: config.port,
    proxy: config.proxy || {},
    beforeMiddleware(app) {
      // This service worker file is effectively a 'no-op' that will reset any
      // previous service worker registered for the same host:port combination.
      // We do this in development to avoid hitting the production cache if
      // it used the same host and port.
      // https://github.com/facebookincubator/create-react-app/issues/2272#issuecomment-302832432
      app.use(noopServiceWorkerMiddleware());
    },
    beforeServer(devServer) {
      try {
        applyMock(devServer);
      } catch (e) {
        console.log(e);
      }
    },
    afterServer(devServer) {
      returnedWatchConfig(devServer);
    },
    onCompileDone({ urls, appName }) {
      if (isFirstCompile) {
        initBrowserSync({
          urls,
          appName,
          cwd,
          autoOpenBrowser,
          disableBrowserSync: config.disableBrowserSync,
        });
        isFirstCompile = false;
      } else {
        bs && bs.active && bs.reload(); // eslint-disable-line
      }
    },
  });
}