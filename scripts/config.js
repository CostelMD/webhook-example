const { jsonSchemaValidate } = require('./dependencies');

const { getConfItem, setConfItem } = require('./utils/config');
const log = require('./utils/logger');
const configSchema = require('./config-schema');

const getWebhookConfig = (data, callback) => {
    try {
        const configJson = getConfItem('configJson') || '[]';
        const config = JSON.parse(configJson);
        parseConfigBeforeSending(config);
        callback(null, { config });
    } catch (error) {
        error.source = error.source || 'config.js -> getWebhookConfig';
        log('error', `[${error.source}]`, error, true);
        callback(new Error(`Failed to retrieve app config. Error: ${error.message}.`));
    }
};

const validateConfig = configJson => {
    let config;

    try {
        config = JSON.parse(configJson);
    } catch (error) {
        const err = new Error(`Invalid JSON format (${error.message})`);
        err.source = 'config.js -> validateConfig';
        throw err;
    }

    parseReceivedConfig(config);

    const { errors } = jsonSchemaValidate(config, configSchema);

    if (errors.length > 0) {
        const err = new Error(errors[0].stack);
        err.source = 'config.js -> validateConfig';
        throw err;
    }

    return config;
};

const saveWebhookConfig = (data, callback) => {
    try {
        const { configJson } = data;
        const config = validateConfig(configJson);
        setConfItem('configJson', JSON.stringify(config));
        parseConfigBeforeSending(config);
        callback(null, { config });
    } catch (error) {
        error.source = error.source || 'config.js -> saveWebhookConfig';
        log('error', `[${error.source}]`, error, true);
        callback(new Error(`Failed to save app config. Error: ${error.message}.`));
    }
};

const parseReceivedConfig = (config) => {
    setWebHookConfigDefaultValues(config);

    config.forEach((item) => {
        ['companies', 'staffGroups', 'parentCompanies', 'excludedCompanies'].forEach(key => {
            if (typeof item.triggerFor[key] === 'string')
                item.triggerFor[key] = item.triggerFor[key].replace(/\s/g, '').split(',').map(numberAsString => parseInt(numberAsString));
        });
    });
};

const parseConfigBeforeSending = (config) => {
    config.forEach((item) => {
        ['companies', 'staffGroups', 'parentCompanies', 'excludedCompanies'].forEach(key => {
            if (typeof item.triggerFor[key] !== 'string')
                item.triggerFor[key] = item.triggerFor[key].join(',');
        });
    });
};

const setWebHookConfigDefaultValues = (config) => {
    config.forEach((item) => {
        item.events = item.events || [];
        item.triggerFor = item.triggerFor || {};
        item.triggerFor.companies = item.triggerFor.companies || [];
        item.triggerFor.staffGroups = item.triggerFor.staffGroups || [];
        item.triggerFor.parentCompanies = item.triggerFor.parentCompanies || [];
        item.triggerFor.excludedCompanies = item.triggerFor.excludedCompanies || [];
    });
};

module.exports = {
    getWebhookConfig,
    saveWebhookConfig
};