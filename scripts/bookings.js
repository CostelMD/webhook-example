const { axios } = require('./dependencies');

const log = require('./utils/logger');
const { isDuplicateTrigger } = require('./check-trigger');
const { getConfItem } = require('./utils/config');
const { getLiquidResolvedPayloads } = require('./utils/liquid-payload-parser');
const { getCustomResolvedPayloads } = require('./utils/custom-payload-parser');
const { updateAxiosOptionsForMtls } = require('./utils/auth/mtls');
const { updateAxiosOptionsForAuth } = require('./utils/auth/auth');
const { getCompaniesChildrenIds, getStaffGroupId } = require('./utils/jrni');
const { sendToRaygunExtApp } = require('./utils/send-to-raygun/send-to-raygun-ext-app');

const filterConfig = async (event, config, booking) => {
    try {
        // 1st phase (no additional data required from JRNI)
        config = config.filter(configItem => {
            if (configItem.events.length === 0 || !configItem.events.includes(event))
                return false;

            if (configItem.triggerFor.companies.length > 0 && !configItem.triggerFor.companies.includes(booking.company_id))
                return false;

            return true;
        });

        // 2nd phase (additional data required from JRNI)
        const staffGroupIdIsRequired = config.some((configItem) => configItem.triggerFor.staffGroups.length > 0);

        if (staffGroupIdIsRequired) {
            const staffGroupId = await getStaffGroupId(booking);
            config = config.filter(configItem => configItem.triggerFor.staffGroups.length === 0 || configItem.triggerFor.staffGroups.includes(staffGroupId));
        }

        return config;
    } catch (error) {
        error.source = error.source || 'booking.js -> filterConfig';
        throw error;
    }
};

const updateTriggerForCompanies = async (config) => {
    try {
        const requests = config.map((configItem) => getCompaniesChildrenIds(configItem.triggerFor.parentCompanies));
        const companiesChildrenIds = await Promise.all(requests);
        config.forEach((configItem, configIndex) => {
            configItem.triggerFor.companies = [...configItem.triggerFor.companies, ...companiesChildrenIds[configIndex]];
            configItem.triggerFor.companies = configItem.triggerFor.companies.filter((company) => !configItem.triggerFor.excludedCompanies.includes(company));
        });
    }
    catch (error) {
        error.source = error.source || 'booking.js -> updateTriggerForCompanies';
        throw error;
    }
};

const sendData = async (config, booking) => {
    try {
        const liquidPayloads = config.map(configItem => configItem.payload);
        let payloads = await getLiquidResolvedPayloads(liquidPayloads, booking);
        payloads = await getCustomResolvedPayloads(payloads, booking);

        const requests = config.map(async (configItem, configItemIndex) => {
            const axiosOptions = {
                method: 'post',
                url: configItem.url,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: payloads[configItemIndex]
            };

            if (configItem.mtls)
                await updateAxiosOptionsForMtls(axiosOptions, configItem.mtls);

            if (configItem.auth)
                await updateAxiosOptionsForAuth(axiosOptions, configItem.auth);

            return axios(axiosOptions);
        });

        await Promise.all(requests);
    } catch (error) {
        error.source = error.source || 'booking.js -> sendData';
        throw error;
    }
};

const afterCreateBooking = async (data, callback) => {
    try {
        // There is some weird caching issue sometimes so make sure we have the right data
        const booking = await data.booking.$get('self', { no_cache: true });

        // Filter the config
        const configJson = getConfItem('configJson') || '[]';
        let config = JSON.parse(configJson);
        await updateTriggerForCompanies(config);
        config = await filterConfig('create', config, booking);

        await sendData(config, booking);

        callback(null, {});
    }
    catch (error) {
        error.source = error.source || 'booking.js -> afterCreateBooking';
        log('error', `[${error.source}]`, error, true);
        sendToRaygunExtApp(error);
        callback(new Error(`The afterCreateBooking handler failed. Error: ${error.message}.`));
    }
};

const afterUpdateBooking = async (data, callback) => {
    try {
        // There is some weird caching issue sometimes so make sure we have the right data
        const booking = await data.booking.$get('self', { no_cache: true });

        // Detect if it is duplicate trigger (the issue related to multiple triggers for a single update)
        const duplicateCheckPayload = {
            id: booking.id,
            company_id: booking.company_id,
            datetime: booking.datetime,
            person_id: booking.person_id,
            current_multi_status: booking.current_multi_status ? booking.current_multi_status : 'confirmed'
        };

        if (await isDuplicateTrigger(duplicateCheckPayload)) {
            log('warn', '[booking.js -> afterUpdateBooking] DUPLICATE TRIGGER, execution aborted', '', true);
            callback(null, {});
            return;
        }

        // Filter the config
        const configJson = getConfItem('configJson') || '[]';
        let config = JSON.parse(configJson);
        await updateTriggerForCompanies(config);
        config = await filterConfig('update', config, booking);

        await sendData(config, booking);

        callback(null, {});
    } catch (error) {
        error.source = error.source || 'booking.js -> afterUpdateBooking';
        log('error', `[${error.source}]`, error, true);
        sendToRaygunExtApp(error);
        callback(new Error(`The afterUpdateBooking handler failed. Error: ${error.message}.`));
    }
};

const afterDeleteBooking = async (data, callback) => {
    try {
        // There is some weird caching issue sometimes so make sure we have the right data
        const booking = await data.booking.$get('self', { no_cache: true });

        // Filter the config
        const configJson = getConfItem('configJson') || '[]';
        let config = JSON.parse(configJson);
        await updateTriggerForCompanies(config);
        config = await filterConfig('cancel', config, booking);

        await sendData(config, booking);

        callback(null, {});
    }
    catch (error) {
        error.source = error.source || 'booking.js -> afterDeleteBooking';
        log('error', `[${error.source}]`, error, true);
        sendToRaygunExtApp(error);
        callback(new Error(`The afterDeleteBooking handler failed. Error: ${error.message}.`));
    }
};

module.exports = {
    afterCreateBooking,
    afterUpdateBooking,
    afterDeleteBooking
};