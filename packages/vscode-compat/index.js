'use strict';

function runtime() {
  return globalThis.__openlibingRmVscodeRuntime || {};
}

function emit(level, message) {
  const active = runtime();
  if (typeof active.emit === 'function') {
    active.emit(level, String(message));
  }
}

function selectableItems(argumentsList) {
  return argumentsList.filter((value) => typeof value === 'string');
}

async function show(level, message, ...items) {
  emit(level, message);
  const active = runtime();
  if (typeof active.choose === 'function') {
    return active.choose(String(message), selectableItems(items));
  }
  return undefined;
}

const workspace = {
  get workspaceFolders() {
    return runtime().workspaceFolders || undefined;
  },
  getConfiguration(section) {
    return {
      get(key, fallback) {
        const config = runtime().configuration || {};
        return config[`${section}.${key}`] ?? fallback;
      },
      async update(key, value) {
        const active = runtime();
        if (typeof active.updateConfiguration === 'function') {
          await active.updateConfiguration(`${section}.${key}`, value);
        }
      }
    };
  }
};

module.exports = {
  workspace,
  window: {
    createOutputChannel(name) {
      return {
        appendLine(message) {
          emit('debug', `[${name}] ${message}`);
        },
        show() {},
        dispose() {}
      };
    },
    showInformationMessage(message, ...items) {
      return show('info', message, ...items);
    },
    showWarningMessage(message, ...items) {
      return show('warning', message, ...items);
    },
    showErrorMessage(message, ...items) {
      return show('error', message, ...items);
    }
  },
  commands: {
    async executeCommand() {
      return undefined;
    }
  },
  env: {
    appName: 'openlibing-rm',
    appRoot: '',
    uriScheme: 'openlibing-rm',
    async openExternal(uri) {
      emit('info', `External URI requested: ${uri}`);
      return true;
    }
  },
  Uri: {
    parse(value) {
      return {
        fsPath: String(value),
        toString() {
          return String(value);
        }
      };
    }
  },
  ConfigurationTarget: {
    Global: true
  }
};
