const store = new Map();

const cloneValue = (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
};

const get = (key) => {
  const item = store.get(key);
  if (!item) {
    return null;
  }

  if (item.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  return cloneValue(item.value);
};

const set = (key, value, ttlSeconds) => {
  store.set(key, {
    value: cloneValue(value),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  return value;
};

const remember = async (key, ttlSeconds, resolver) => {
  const cached = get(key);
  if (cached !== null) {
    return cached;
  }

  const value = await resolver();
  set(key, value, ttlSeconds);
  return value;
};

const forget = (key) => {
  store.delete(key);
};

const forgetPrefix = (prefix) => {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
};

const clear = () => {
  store.clear();
};

module.exports = {
  clear,
  forget,
  forgetPrefix,
  get,
  remember,
  set,
};
