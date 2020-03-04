'use strict';

import React from 'react';
import url from 'url';
import queryString from 'query-string';
import _ from 'underscore';
import memoize from 'memoize-one';
import ReactTooltip from 'react-tooltip';
var serialize = require('form-serialize');
import { detect as detectBrowser } from 'detect-browser';
import jsonScriptEscape from '../libs/jsonScriptEscape';
import { content_views as globalContentViews, portalConfig, getGoogleAnalyticsTrackingID, analyticsConfigurationOptions } from './globals';
import ErrorPage from './static-pages/ErrorPage';
import { NavigationBar } from './navigation/NavigationBar';
import { Footer } from './Footer';
import { store } from './../store';

import { Alerts } from '@hms-dbmi-bgm/shared-portal-components/es/components/ui/Alerts';
import { ajax, JWT, console, isServerSide, object, layout, analytics, isSelectAction, memoizedUrlParse } from '@hms-dbmi-bgm/shared-portal-components/es/components/util';
import { Schemas, SEO, typedefs, navigate } from './util';
import { requestAnimationFrame as raf } from '@hms-dbmi-bgm/shared-portal-components/es/components/viz/utilities';

import { FacetCharts } from './browse/components/FacetCharts';
import { ChartDataController } from './viz/chart-data-controller';
import { PageTitleSection } from './PageTitle';

// eslint-disable-next-line no-unused-vars
const { NavigateOpts } = typedefs;


/**
 * Creates a promise which completes after a delay, performing no network request.
 * Used to perform a promise.race to see if this timeout or a network requests completes first, which
 * then allows us to set app.state.slow and render a loading icon until long-running network request completes.
 *
 * @private
 */
class Timeout {
    /**
     * @param {number} timeout - The length of time before this promise resolves.
     */
    constructor(timeout) {
        /**
         * Internal promise object which resolves after length of time as specified by `timeout`.
         * @private
         */
        this.promise = new Promise((resolve) => setTimeout(resolve.bind(null, this), timeout));
    }
}

/**
 * The root and top-most React component for our application.
 * This is wrapped by a Redux store and then rendered by either the server-side
 * NodeJS sub-process or by the browser.
 *
 * @see https://github.com/4dn-dcic/fourfront/blob/master/src/encoded/static/server.js
 * @see https://github.com/4dn-dcic/fourfront/blob/master/src/encoded/static/browser.js
 */
export default class App extends React.PureComponent {

    /**
     * Defines time before a 'slow loading' indicator appears on page.
     *
     * @constant
     * @type {number}
     */
    static SLOW_REQUEST_TIME = 750;

    /**
     * Immediately scrolls browser viewport to current window hash or to top of page.
     *
     * @returns {void} Nothing
     */
    static scrollTo() {
        var { hash } = window.location;
        if (hash && document.getElementById(hash.slice(1))) {
            window.location.replace(hash);
        } else {
            window.scrollTo(0, 0);
        }
    }

    /**
     * Used in browser.js to collect prop values from server-side-rendered HTML
     * and then re-feed them into Redux store.
     *
     * @param {HTMLElement} document - HTML DOM element representing the document.
     * @param {string} [filter=null] - If set, filters down prop fields/values collected to only one(s) defined.
     * @returns {Object} Object keyed by field name with collected value as value.
     */
    static getRenderedPropValues(document, filter = null){
        var returnObj = {}, script_props;
        if (typeof filter === 'string'){
            script_props = document.querySelectorAll('script[data-prop-name="' + filter + '"]');
        } else {
            script_props = document.querySelectorAll('script[data-prop-name]');
        }
        _.forEach(script_props, function(elem){
            const prop_name = elem.getAttribute('data-prop-name');
            if (filter && Array.isArray(filter)){
                if (filter.indexOf(prop_name) === -1){
                    return;
                }
            }
            let elem_value = elem.text;
            const elem_type = elem.getAttribute('type') || '';
            if (elem_type === 'application/json' || elem_type.slice(-5) === '+json') {
                elem_value = JSON.parse(elem_value);
            }
            returnObj[prop_name] = elem_value;
        });
        return returnObj;
    }

    /**
     * Runs `App.getRenderedPropValues` and extends with `{ href }` from canonical link element.
     *
     * @param {HTMLElement} document - HTML DOM element representing the document.
     * @param {string} [filters=null] - If set, filters down prop fields/values collected to only one(s) defined.
     * @returns {Object} Object keyed by field name with collected value as value.
     */
    static getRenderedProps(document, filters = null) {
        return _.extend(App.getRenderedPropValues(document, filters), {
            'href' : document.querySelector('link[rel="canonical"]').getAttribute('href') // Ensure the initial render is exactly the same
        });
    }

    /**
     * @property {boolean} initialSession - Whether user is logged in upon initial render. Only passed in on server-side render.
     */
    static defaultProps = {
        'initialSession' : null
    };

    static debouncedOnNavigationTooltipRebuild = _.debounce(ReactTooltip.rebuild, 500);

    /**
     * Does some initialization, checks if browser HistoryAPI is supported,
     * sets state.session according to JWT in current cookie, etc.
     */
    constructor(props){
        super(props);
        _.bindAll(this, 'currentAction', 'loadSchemas',
            'setIsSubmitting', 'stayOnSubmissionsPage', 'authenticateUser',
            'updateUserInfo', 'confirmNavigation', 'navigate',
            // Global event handlers. These will catch events unless they are caught and prevented from bubbling up earlier.
            'handleClick', 'handleSubmit', 'handlePopState', 'handleBeforeUnload'
        );

        const { context, initialSession } = props;

        Alerts.setStore(store);

        /**
         * Whether HistoryAPI is supported in current browser.
         * Assigned / determined in constructor.
         *
         * @type {boolean}
         */
        this.historyEnabled = !!(typeof window != 'undefined' && window.history && window.history.pushState);

        // Todo: Migrate session & user_actions to redux store?
        let session = false;
        if (typeof initialSession === 'boolean'){
            // Only provided from server
            session = initialSession;
        } else {
            // Only available client-side. Same cookie sent to server-side to authenticate initialSession, so it must match.
            session = !!(JWT.get('cookie'));
        }

        // Save navigate fxn and other req'd stuffs to GLOBAL navigate obj.
        // So that we may call it from anywhere if necessary without passing through props.
        navigate.setNavigateFunction(this.navigate);
        navigate.registerCallbackFunction(Alerts.updateCurrentAlertsTitleMap.bind(this, null));

        if (context.schemas) Schemas.set(context.schemas);

        /**
         * Initial state of application.
         *
         * @type {Object}
         * @property {boolean}  state.session       Whether user is currently logged in or not. User details are retrieved using JWT utility.
         * @property {Object[]} state.schemas       Current schemas; null until AJAX-ed in (may change).
         * @property {boolean}  state.isSubmitting  Whether there's a submission in progress. If true, alert is shown to prevent user from accidentally navigating away.
         * @property {boolean}  state.mounted       Whether app has been mounted into DOM in browser yet.
         */
        this.state = {
            session,
            'schemas'           : context.schemas || null,
            'isSubmitting'      : false,
            'mounted'           : false
        };

        // Holds a reference to current navigation request for `context`.
        // (App works as a single-page-application (SPA))
        this.currentNavigationRequest = null;

        console.info("App Initial State: ", this.state);
    }

    /**
     * Perform various actions once component is mounted which depend on browser environment:
     *
     * - Add URI hash from window.location.hash/href to Redux store (doesn't get sent server-side).
     * - Bind 'handlePopState' function to window popstate event (e.g. back/forward button navigation).
     * - Initializes Google Analytics
     * - Exposes 'API' from browser window object via property {Object} 'fourfront' which has reference to Alerts, JWT, navigate, and this app component.
     * - Emits an event from browser window named 'fourfrontinitialized', letting any listeners (parent windows, etc.) know that JS of this window has initialized. Posts message with same 'eventType' as well.
     * - Shows browser suggestion alert if not using Chrome, Safari, Firefox.
     * - Sets state.mounted to be true.
     * - Clears out any UTM URI parameters three seconds after mounting (giving Google Analytics time to pick them up).
     *
     * @private
     */
    componentDidMount() {
        const { href, context } = this.props;

        // The href prop we have was from serverside. It would not have a hash in it, and might be shortened.
        // Here we grab full-length href from window and then update props.href (via Redux), if it is different.
        const windowHref = (window && window.location && window.location.href) || href;
        if (href !== windowHref){
            store.dispatch({ 'type' : { 'href' : windowHref } });
        }

        // Load up analytics
        // Load up analytics & perform initial pageview track
        const analyticsID = getGoogleAnalyticsTrackingID(href);
        if (analyticsID){
            analytics.initializeGoogleAnalytics(
                analyticsID,
                {
                    ...analyticsConfigurationOptions,
                    reduxStore: store,
                    initialContext: context,
                    initialHref: windowHref
                }
            );
        }

        // Authenticate user if not yet handled server-side w/ cookie and rendering props.
        this.authenticateUser();

        // Load schemas into app.state, access them where needed via props (preferred, safer) or this.context.
        this.loadSchemas();

        if (this.historyEnabled) {
            try {
                window.history.replaceState(context, '', window.location.href);
            } catch (exc) {
                // Might fail due to too large data
                window.history.replaceState(null, '', window.location.href);
            }
            // Avoid popState on load, see: http://stackoverflow.com/q/6421769/199100
            var register = window.addEventListener.bind(window, 'popstate', this.handlePopState, true);
            if (window._onload_event_fired) {
                register();
            } else {
                window.addEventListener('load', setTimeout.bind(window, register));
            }
        } else {
            window.onhashchange = this.onHashChange;
        }

        window.onbeforeunload = this.handleBeforeUnload;

        // Save some stuff to global window variables so we can access it in tests:
        // Normally would call this 'window.app' but ENCODE already sets this in browser.js to be the top-level Redux provider (not really useful, remove?)
        window.fourfront = _.extend(window.fourfront || {}, {
            'app'       : this,
            'alerts'    : Alerts,
            'JWT'       : JWT,
            'navigate'  : navigate
        });

        // Detect browser and save it to state. Show alert to inform people we're too ~lazy~ under-resourced to support MS Edge to the max.
        const browserInfo = detectBrowser();

        console.info('BROWSER', browserInfo);

        if (browserInfo && typeof browserInfo.name === 'string' && ['chrome', 'firefox', 'safari'].indexOf(browserInfo.name) === -1){
            Alerts.queue({
                'title' : 'Browser Suggestion',
                'message' : (
                    <div>
                        <p className="mb-0">
                            <a href="https://www.google.com/chrome/" rel="noopener noreferrer" target="_blank" className="text-500">Google Chrome</a>
                            or <a href="https://www.mozilla.org/en-US/firefox/" rel="noopener noreferrer" target="_blank" className="text-500">Mozilla Firefox</a> are
                            the recommended browser(s) for using the 4DN Data Portal.
                        </p>
                        <p className="mb-0">
                            Microsoft Edge, Safari, etc. should work for a majority of portal functions but are not explicitly supported and may present some glitches, e.g. during submission.
                        </p>
                    </div>
                ),
                'style' : 'warning'
            });
        }

        // Post-mount stuff
        this.setState({ 'mounted' : true, browserInfo }, () => {

            console.log('App is mounted, dispatching fourfrontinitialized event.');
            // DEPRECATED:
            // Emit event from our window object to notify that fourfront JS has initialized.
            // This is to be used by, e.g. submissions view which might control a child window.
            window.dispatchEvent(new Event('fourfrontinitialized'));
            // CURRENT: If we have parent window, post a message to it as well.
            if (window.opener) window.opener.postMessage({ 'eventType' : 'fourfrontinitialized' }, '*');

            // If we have UTM URL parameters in the URI, attempt to set history state (& browser) URL to exclude them after a few seconds
            // after Google Analytics may have stored proper 'source', 'medium', etc. (async)
            const urlParts = url.parse(windowHref, true);
            const paramsToClear = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

            if (urlParts.query && _.any(paramsToClear, function(prm){ return typeof urlParts.query[prm] !== 'undefined'; })){
                setTimeout(()=>{
                    var queryToSet = _.clone(urlParts.query);
                    _.forEach(paramsToClear, function(prm){ typeof queryToSet[prm] !== 'undefined' && delete queryToSet[prm]; });
                    var nextUrl = (
                        urlParts.protocol + '//' + urlParts.host +
                        urlParts.pathname + (_.keys(queryToSet).length > 0 ? '?' + queryString.stringify(queryToSet) : '')
                    );
                    if (nextUrl !== windowHref && this.historyEnabled){
                        try {
                            window.history.replaceState(context, '', nextUrl);
                        } catch (exc) {
                            // Might fail due to too large data
                            window.history.replaceState(null, '', nextUrl);
                        }
                        console.info('Replaced UTM params in URI:', windowHref, nextUrl);
                    }
                }, 3000);
            }
        });
    }

    /** @ignore */
    componentDidUpdate(prevProps, prevState) {
        const { href, context } = this.props;
        const { session } = this.state;

        var key;

        if (href !== prevProps.href){ // We navigated somewhere else.

            // Register google analytics pageview event.
            analytics.registerPageView(href, context);

            // We need to rebuild tooltips after navigation to a different page.
            // Add a debounce so it runs again after a delay, so other components get a chance to mount.
            App.debouncedOnNavigationTooltipRebuild();
        }

        // We could migrate this block of code to ChartDataController if it were stored in Redux.
        if (prevState.session !== session && ChartDataController.isInitialized()){
            setTimeout(function(){
                console.log("SYNCING CHART DATA");
                ChartDataController.sync();
            }, 0);
        }

        // We can skip doing this unless debugging on localhost-
        if (console.isDebugging()){

            for (key in this.props) {
                // eslint-disable-next-line react/destructuring-assignment
                if (this.props[key] !== prevProps[key]) {
                    console.log('changed props: %s', key);
                }
            }

            for (key in this.state) {
                // eslint-disable-next-line react/destructuring-assignment
                if (this.state[key] !== prevState[key]) {
                    console.log('changed state: %s', key);
                }
            }

        }

    }

    /**
     * Calculates current action, if any, from URL hash.
     *
     * @public
     * @param {string} [href] - Href to get current action from. Optional.
     * @returns {!string} Current action if any, or null.
     */
    currentAction(href) {
        const { href : propHref } = this.props;
        if (!href) {
            href = propHref;
        }
        const query =  memoizedUrlParse(href).query || {};
        let action = query.currentAction || null;

        // Handle list of values, e.g. if `currentAction=selection&currentAction=selection&currentAction=edit` or something is in URL.
        // We should __not__ get an array here and is glitch, but if so, lets fallback and choose _1st_ non-null item.
        if (Array.isArray(action)){
            console.error("Received unexpected list for `currentAction` URI param", action);
            action = _.filter(action);
            action = (action.length > 0 ? action[0] : null);
        }

        return action;
    }

    /**
     * If no schemas yet stored in our state, we AJAX them in from `/profiles/?format=json`.
     *
     * @public
     * @param {function} [callback=null] - If defined, will be executed upon completion of load, with schemas passed in as first argument.
     * @param {boolean} [forceFetch=false] - If true, will ignore any previously-fetched schemas and fetch new ones.
     * @returns {void}
     */
    loadSchemas(callback = null, forceFetch = false){
        const { schemas } = this.state;
        if (schemas !== null && !forceFetch){
            // We've already loaded these successfully (hopefully)
            if (typeof callback === 'function') callback(schemas);
            console.info('Schemas available already.');
            return schemas;
        }
        ajax.promise('/profiles/?format=json').then((data) => {
            if (object.isValidJSON(data)){
                Schemas.set(data);
                this.setState({ 'schemas' : data }, () => {
                    // Rebuild tooltips because they likely use descriptions from schemas
                    ReactTooltip.rebuild();
                    if (typeof callback === 'function') callback(data);
                    console.info('Loaded schemas');
                });
            }
        });
    }

    /**
     * Intercepts a click on a hyperlink HTML element
     * and navigates to its target href if is an internal link.
     * Skips for download links, external links, etc.
     *
     * @private
     * @param {React.SyntheticEvent} event React SyntheticEvent for click MouseEvent.
     */
    handleClick(event) {
        // https://github.com/facebook/react/issues/1691
        if (event.isDefaultPrevented()) return;
        const { href } = this.props;
        const { nativeEvent } = event;
        const target = layout.elementIsChildOfLink(event.target);

        if (!target) return;

        if (target.getAttribute('disabled')) {
            event.preventDefault();
            return;
        }

        // Ensure this is a plain click
        if (nativeEvent.which > 1 || nativeEvent.shiftKey || nativeEvent.altKey || nativeEvent.metaKey) return;

        // Skip links with a data-bypass attribute.
        if (target.getAttribute('data-bypass')){
            return false;
        }

        const targetHref = target.getAttribute('href') || target.getAttribute('data-href');

        if (targetHref === null){
            return false;
        }

        // Skip javascript links
        if (targetHref.indexOf('javascript:') === 0) return false;

        // Skip external links
        if (!navigate.sameOrigin(targetHref)) return false;

        // Skip links with a different target
        if (target.getAttribute('target')) return false;

        // Skip @@download links
        if (targetHref.indexOf('/@@download') != -1) return false;

        // With HTML5 history supported, local navigation is passed
        // through the navigate method.
        if (this.historyEnabled) {
            event.preventDefault();

            const tHrefParts = url.parse(targetHref);
            const pHrefParts = memoizedUrlParse(href);
            let tHrefHash = tHrefParts.hash;
            const samePath = pHrefParts.path === tHrefParts.path;
            const navOpts = {
                // Same pathname & search but maybe different hash. Don't add history entry etc.
                'replace'           : samePath,
                'skipRequest'       : samePath || !!(target.getAttribute('data-skiprequest')),
                'dontScrollToTop'   : samePath
            };
            let targetOffset = target.getAttribute('data-target-offset');
            const noCache      = target.getAttribute('data-no-cache');

            // Don't cache requests to user profile.
            if (noCache) navOpts.cache = false;

            navigate(targetHref, navOpts, function(){
                if (targetOffset) targetOffset = parseInt(targetOffset);
                if (!targetOffset || isNaN(targetOffset)) targetOffset = 112;
                if (tHrefHash && typeof tHrefHash === 'string' && tHrefHash.length > 1 && tHrefHash[1] !== '!'){
                    tHrefHash = tHrefHash.slice(1); // Strip out '#'
                    setTimeout(layout.animateScrollTo.bind(null, tHrefHash, 750, targetOffset), 100);
                }
            });

            if (target && target.blur) target.blur();
        }
    }

    /**
     * Intercepts a form submission on a form HTML element
     * and performs it via AJAX. Similar to handling of hyperlinks.
     *
     * @private
     * @param {React.SyntheticEvent} event Form submission event.
     */
    handleSubmit(event) {
        const { href } = this.props;
        const { target } = event;
        const hrefParts = memoizedUrlParse(href);

        // Skip POST forms
        if (target.method !== 'get') return;

        // Skip forms with a data-bypass attribute.
        if (target.getAttribute('data-bypass')) return;

        // Skip external forms
        if (!navigate.sameOrigin(target.action)) return;

        const actionUrlParts  = url.parse(url.resolve(href, target.action));
        const currentAction   = this.currentAction();
        const navOptions      = {
            'replace'       : actionUrlParts.pathname == hrefParts.pathname,
            'skipRequest'   : !!(target.getAttribute('data-skiprequest'))
        };
        let search = serialize(target);
        let targetHref = actionUrlParts.pathname;

        if (target.getAttribute('data-removeempty')) {
            search = _.map(
                _.filter(search.split('&'), function (item) {
                    return item.slice(-1) != '=';
                }),
                function(item){
                    var split = item.split('=');
                    return split[0] + '=' + encodeURIComponent(split[1]).replace(/(')/g, "%27");
                }
            ).join('&');
        }

        // If we're submitting search form in selection mode, preserve selection mode at next URL.
        if (isSelectAction(currentAction)){
            if (search && search.indexOf('currentAction=' + currentAction) === -1){
                search += ('&currentAction=' + currentAction);
            } else if (!search) {
                search = ('currentAction=' + currentAction);
            }
        }

        // Append form name:vals as stringified URI params (`search`).
        if (search) targetHref += '?' + search;

        if (this.historyEnabled) {
            event.preventDefault();
            navigate(targetHref, navOptions);
        } // Else is submitted as normal browser HTTP GET request if event.preventDefault() not called.
    }

    /**
     * Handles a history change event.
     *
     * @private
     * @param {React.SyntheticEvent} event - A popstate event.
     */
    handlePopState(event) {
        if (this.DISABLE_POPSTATE) return;
        const { href, context } = this.props;
        const windowHref = window.location.href; // Href which browser just navigated to, but maybe not yet set to this.props.href

        if (!this.confirmPopState(windowHref)){
            try {
                // Undo what we just did (hit the back button) by re-adding it to history and returning (not performing actual naivgate backward)
                window.history.pushState(event.state, '', href);
            } catch (e){ // Too large
                console.warn('error pushing state (current, popped:)', context, event.state);
                window.history.pushState(null, '', href);
            }
            return;
        }

        if (!this.historyEnabled) {
            window.location.reload();
            return;
        }

        if (event.state) {
            // Abort inflight xhr before dispatching
            if (this.currentNavigationRequest !== null) {
                this.currentNavigationRequest.abort();
                this.currentNavigationRequest = null;
            }
            store.dispatch({
                type: {
                    'href' : windowHref,
                    'context' : event.state
                }
            });
        }

        // Always async update in case of server side changes.
        navigate(windowHref, { 'replace': true });
    }

    /**
     * Grabs JWT from local cookie and, if not already authenticated or are missing 'user_actions',
     * perform authentication via AJAX to grab user actions, updated JWT token, and save to localStorage.
     *
     * @deprecated (?) Since browser.js calls JWT.remove() + reloads as anonymous user
     * @private
     * @param {function} [callback=null] Optional callback to be ran upon completing authentication.
     * @returns {void}
     */
    authenticateUser(callback = null){
        const { session } = this.state;
        const idToken = JWT.get();

        // Currently we usually only have at most 1 group per User.
        // If changes, we may need to register multiple events
        // or figure out prioritization of group to register.
        const {
            user_actions: userActions = null,
            details: {
                uuid: userId = null,
                groups = null
            } = {}
        } = JWT.getUserInfo() || {};

        if (idToken && (!session || !userId || !userActions)){
            // if JWT present, and session not yet set (from back-end), try to authenticate
            // This is very unlikely due to us rendering re: session server-side. Mostly a remnant or if localStorage cleared.
            console.info('AUTHENTICATING USER; JWT PRESENT BUT NO STATE.SESSION OR USER_ACTIONS');
            ajax.promise('/login', 'POST', { 'Authorization' : 'Bearer ' + idToken }, JSON.stringify({ 'id_token' : idToken }))
                .then((response) => {
                    if (response.code || response.status || response.id_token !== idToken) throw response;
                    return response;
                })
                .then(
                    (response) => {
                        JWT.saveUserInfo(response);
                        this.updateUserInfo(callback);
                        analytics.setUserID(userId);
                        analytics.event('Authentication', 'ExistingSessionLogin', {
                            userId,
                            name: userId,
                            userGroups: groups && JSON.stringify(groups.sort()),
                            eventLabel: 'Authenticated ClientSide'
                        });
                    },
                    (error) => {
                        // error, clear JWT token from cookie & user_info from localStorage (via JWT.remove())
                        // and unset state.session (via this.updateUserInfo())
                        JWT.remove();
                        this.updateUserInfo(callback);
                    }
                );
            return idToken;
        } else {
            console.info('User is logged in already, continuing session.');
            // analytics.setUserID(userId); is performed in SPC/analytics.js on init.
            analytics.event('Authentication', 'ExistingSessionLogin', {
                userId,
                name: userId,
                userGroups: groups && JSON.stringify(groups.sort()),
                eventLabel: 'Authenticated ServerSide'
            });
        }
        return null;
    }

    /**
     * Tests that JWT is present along with user info and user actions, and if so, updates `state.session`.
     * Called by `authenticateUser` as well as Login.
     *
     * @public
     * @param {function} [callback=null] Optional callback to be ran upon completing authentication.
     * @returns {void}
     */
    updateUserInfo(callback = null){
        // get user actions (a function of log in) from local storage
        const userInfo  = JWT.getUserInfo();
        // We definitively use Cookies for JWT.
        // It can be unset via response headers from back-end.
        const currentToken = JWT.get('cookie');
        const session = !!(userInfo && currentToken); // cast to bool

        this.setState(function({ session : existingSession }){
            if (session === existingSession) {
                return null;
            }
            if (session === false && existingSession === true){
                Alerts.queue(Alerts.LoggedOut);
                // Clear out remaining auth/JWT stuff from localStorage if any
                JWT.remove();
            }
            return { session };
        }, () => {
            if (typeof callback === 'function'){
                callback(session, userInfo);
            }
        });
    }

    /**
     * Updates Redux store with non-hash version of URI. For IE8/9 only.
     *
     * @deprecated
     * @private
     * @param {React.SyntheticEvent} event An event.
     * @returns {void}
     */
    onHashChange(event) {
        store.dispatch({
            type: { 'href' : document.querySelector('link[rel="canonical"]').getAttribute('href') }
        });
    }

    /**
     * Rules to prevent browser from changing to 'href' via back/forward buttons.
     *
     * @private
     * @param {string} href - Next href.
     * @returns {boolean} Whether to proceed with browser navigation.
     */
    confirmPopState(href){
        if (this.stayOnSubmissionsPage(href)) return false;
        return true;
    }

    /**
     * Only navigate if href changes unless is inPlace navigation, if don't need to stay on submissions
     * view, etc.
     *
     * @private
     * @param {string} href - New URI we're navigating to.
     * @param {Object} [options] - Options for navigation request.
     * @returns {boolean}
     */
    confirmNavigation(toHref, options) {
        const { href } = this.props;
        // check if user is currently on submission page
        // if so, warn them about leaving
        if (this.stayOnSubmissionsPage(toHref)){
            return false;
        }

        if (options && options.inPlace && options.inPlace === true){
            return true;
        }

        if (toHref === href){
            return false;
        }
        /*
        var partsNew = url.parse(toHref),
            partsOld = url.parse(href);

        if (partsNew.path === partsOld.path && !globals.isHashPartOfHref(null, partsNew)){
            return false;
        }
        */
        return true;
    }

    /**
     * Check this.state.isSubmitting to prompt user if navigating away
     * from the submissions page.
     *
     * @param {string} [href=null] - Href we are navigating to (in case of navigate, confirmNavigation) or have just navigated to (in case of popState event).
     * @returns {boolean}
     */
    stayOnSubmissionsPage(nextHref = null) {
        const { isSubmitting } = this.state;
        // can override state in options
        // override with replace, which occurs on back button navigation
        if (isSubmitting){
            var nextAction = this.currentAction(nextHref);
            if (nextAction && ['edit', 'create', 'clone'].indexOf(nextAction) > -1){
                // Cancel out if we are "returning" to edit or create (submissions page) href.
                return false;
            }
            if (window.confirm('Leaving will cause all unsubmitted work to be lost. Are you sure you want to proceed?')){
                // we are no longer submitting
                this.setIsSubmitting(false);
                return false;
            } else {
                // stay
                return true;
            }
        } else {
            return false;
        }
    }

    /**
     * Should not be called directly - aliased to global function `util.navigate` during App constructor.
     * Function which is used/called to navigate us around the portal in single-page-application (AJAX)
     * fashion.
     *
     * @alias navigate
     * @private
     * @param {string} href                 URI we're attempting to navigate to.
     * @param {NavigateOpts} [options={}]   Options for the navigation request.
     * @param {function} [callback=null]    Optional callback, accepting response JSON as first argument.
     * @param {function} [fallbackCallback=null] - Optional callback to be called in case request fails.
     * @param {Object} [includeReduxDispatch={}] - Optional extra data to save to Redux store along with the next response.
     * @returns {void}
     */
    navigate(targetHref, options = {}, callback = null, fallbackCallback = null, includeReduxDispatch = {}) {

        const { href, context } = this.props;

        // options.skipRequest only used by collection search form
        // options.replace only used handleSubmit, handlePopState, handlePersonaLogin

        // Holds #hash, if any.
        let hashAppendage = "";

        // What we end up putting into Redux upon request completion.
        // Will include at least `context`, `href`.
        const reduxDispatchDict = _.clone(includeReduxDispatch);


        // Prepare the target href. Cancel out if some rule prevents navigation(s) at moment.
        targetHref = url.resolve(href, targetHref);

        if (!options.skipConfirmCheck && !this.confirmNavigation(targetHref, options)) {
            return false;
        }

        // Strip url hash.
        const hashIndex = targetHref.indexOf('#');
        if (hashIndex > -1) {
            hashAppendage = targetHref.slice(hashIndex);
            targetHref = targetHref.slice(0, hashIndex);
        }

        const doRequest = () => {

            if (!this.historyEnabled) {
                if (options.replace) {
                    window.location.replace(targetHref + hashAppendage);
                } else {
                    const [ old_path ] = ('' + window.location).split('#');
                    window.location.assign(targetHref + hashAppendage);
                    if (old_path === targetHref) {
                        window.location.reload();
                    }
                }
                return false; // Unlike 'null', skips callback b.c. leaving page anyway.
            }

            // Abort the current/previous request, if any.
            if (this.currentNavigationRequest !== null){
                console.warn('Canceling previous navigation request', this.currentNavigationRequest);
                this.currentNavigationRequest.abort();
                this.currentNavigationRequest = null;
                this.setState(function({ slowLoad }){
                    if (!slowLoad) return null;
                    return { 'slowLoad' : false };
                });
            }

            if (options.skipRequest) {
                if (options.replace) {
                    try {
                        window.history.replaceState(context, '', targetHref + hashAppendage);
                    } catch (exc) {
                        console.warn('Data too big, saving null to browser history in place of props.context.');
                        window.history.replaceState(null, '', targetHref + hashAppendage);
                    }
                } else {
                    try {
                        window.history.pushState(context, '', targetHref + hashAppendage);
                    } catch (exc) {
                        console.warn('Data too big, saving null to browser history in place of props.context.');
                        window.history.pushState(null, '', targetHref + hashAppendage);
                    }
                }
                if (!options.skipUpdateHref) {
                    reduxDispatchDict.href = targetHref + hashAppendage;
                }
                if (_.keys(reduxDispatchDict).length > 0){
                    store.dispatch({ 'type' : reduxDispatchDict });
                }
                return false;
            }

            this.currentNavigationRequest = ajax.fetch(targetHref, { 'cache' : options.cache === false ? false : true });
            // Keep a reference in current scope to later assert if same request instance (vs new superceding one).
            const currentRequestInThisScope = this.currentNavigationRequest;
            const timeout = new Timeout(App.SLOW_REQUEST_TIME);

            Promise.race([currentRequestInThisScope, timeout.promise]).then((v) => {
                if (v instanceof Timeout && currentRequestInThisScope === this.currentNavigationRequest) {
                    console.log('TIMEOUT!!!');
                    this.setState(function({ slowLoad }){
                        if (slowLoad) return null;
                        return { 'slowLoad' : true };
                    });
                }
            });

            currentRequestInThisScope
                .then((response)=>{
                    console.info("Fetched new context", response);

                    // Update `state.session` after (possibly) removing expired JWT. Backend does this via set cookie header.
                    // Also, may have been logged out in different browser window so keep state.session up-to-date BEFORE a re-request
                    this.updateUserInfo();

                    if (!object.isValidJSON(response)) { // Probably only if 500 server error or similar. Or link to xml or image etc.
                        // navigate normally to URL of unexpected non-JSON response so back button works.
                        // this cancels out of promise chain & current app JS scope
                        if (options.replace) {
                            window.location.replace(targetHref + hashAppendage);
                        } else {
                            window.location.assign(targetHref + hashAppendage);
                        }
                    }

                    return response;
                })
                .then((response) => {
                    // Get correct URL from XHR, in case we hit a redirect during the request.
                    const responseHref = (
                        currentRequestInThisScope && currentRequestInThisScope.xhr && currentRequestInThisScope.xhr.responseURL
                    ) || targetHref;

                    reduxDispatchDict.href = responseHref + hashAppendage;

                    if (currentRequestInThisScope === this.currentNavigationRequest){ // Ensure we're not de-referencing some new superceding request.
                        this.currentNavigationRequest = null;
                    }
                    return response;
                })
                .then((response) => {
                    // Update redux store w. response/context. Add Browser History Entry.
                    if (options.replace){
                        try { // title (2nd param) for replaceState & pushState is currently ignored by browsers
                            window.history.replaceState(response, '', reduxDispatchDict.href);
                        } catch (exc) {
                            console.warn('Data too big, saving null to browser history in place of props.context.');
                            window.history.replaceState(null, '', reduxDispatchDict.href);
                        }
                    } else {
                        try {
                            window.history.pushState(response, '', reduxDispatchDict.href);
                        } catch (exc) {
                            console.warn('Data too big, saving null to browser history in place of props.context.');
                            window.history.pushState(null, '', reduxDispatchDict.href);
                        }
                    }

                    reduxDispatchDict.context = response;
                    store.dispatch({ 'type' : _.extend({}, reduxDispatchDict, includeReduxDispatch) });
                    return response;
                })
                .then((response) => { // Finalize - clean up `slowLoad : true` if in state, run callbacks and analytics.
                    this.setState(function({ slowLoad }){
                        if (!slowLoad) return null;
                        return { 'slowLoad' : false };
                    });
                    if (typeof callback === 'function'){
                        callback(response);
                    }
                    if (response.code === 404){
                        // This may not be caught as a server or network error.
                        // If is explicit 404 (vs just 0 search results), pyramid will send it as 'code' property.
                        analytics.exception('Page Not Found - ' + targetHref);
                    }
                });

            /**
             * Param `err` could be one of multiple things -
             * It will be an (XMLHttpRequest) XHR object if could not parse JSON.
             * XHR object exposes a numerical `status` property.
             * This would likely occur on 500 server error, 502 timeout error,
             * a 404 error that isn't in for a JSON resource, or similar.
             *
             * In the case of lack of internet connection or similar, `err` would
             * most likely be a `ProgressEvent` object which has a reference to XHR
             * via its `target` property.
             */
            currentRequestInThisScope.catch((err)=>{
                console.log('ERRR', err);
                this.setState(function({ slowLoad }){
                    if (!slowLoad) return null;
                    return { 'slowLoad' : false };
                });

                if (currentRequestInThisScope === this.currentNavigationRequest){
                    // Ensure we're not de-referencing some new superceding request.
                    this.currentNavigationRequest = null;
                }

                if (typeof fallbackCallback == 'function'){
                    fallbackCallback(err);
                }

                console.error('Error in App.navigate():', err);

                if (err.status === 500){
                    analytics.exception('Server Error: ' + err.status + ' - ' + targetHref);
                }

                if (err.status === 404){
                    analytics.exception('Page Not Found - ' + targetHref);
                }

                if (err.message === 'HTTPForbidden'){
                    // An error may be thrown in Promise response chain with this message ("HTTPForbidden") if received a 403 status code in response
                    if (typeof callback === 'function'){
                        callback(err);
                    }
                } else if (typeof err.status === 'number' && [502, 503, 504, 505, 598, 599, 444, 499, 522, 524].indexOf(err.status) > -1) {
                    // Bad connection
                    Alerts.queue(Alerts.ConnectionError);
                    analytics.exception('Network Error: ' + err.status + ' - ' + targetHref);
                } else {
                    Alerts.queue(Alerts.ConnectionError);
                    analytics.exception('Unknown Network Error: ' + err.status + ' - ' + targetHref);
                    // Unknown/unanticipated error: Bubble it up (won't break app).
                    throw err;
                }

                // Possibly not needed: If no major JS error thrown, add entry in Browser History so that back/forward buttons still works after hitting a 404 or similar.
                // title currently ignored by browsers
                if (options.replace){
                    try {
                        window.history.replaceState(err, '', targetHref + hashAppendage);
                    } catch (exc) {
                        console.warn('Data too big, saving null to browser history in place of props.context.');
                        window.history.replaceState(null, '', targetHref + hashAppendage);
                    }
                } else {
                    try {
                        window.history.pushState(err, '', targetHref + hashAppendage);
                    } catch (exc) {
                        console.warn('Data too big, saving null to browser history in place of props.context.');
                        window.history.pushState(null, '', targetHref + hashAppendage);
                    }
                }
            });

            if (!options.replace && !options.dontScrollToTop) {
                currentRequestInThisScope.then(App.scrollTo);
            }

            // currentRequestInThisScope === this.currentNavigationRequest here and in outer `this.navigation` scope.
            // BUT this may not be case later in async Promise chain if new request launched and
            // `abort` not called in time to cancel execution of Promise chain.
            console.info('Navigating > ', currentRequestInThisScope);
            return currentRequestInThisScope;
        };

        const requestIfLaunched = doRequest();
        if (!requestIfLaunched){ // We cancelled out somewhere due to `options.skipRequest` or similar.
            if (typeof callback === 'function'){
                setTimeout(callback, 100);
            }
        }
        return requestIfLaunched; // === this.currentNavigationRequest definitively here still, until async Promise chain.
    }

    /**
     * Set 'isSubmitting' in state. works with handleBeforeUnload
     *
     * @param {boolean} bool - Value to set.
     * @param {function} [callback=null] - Optional callback to execute after updating state.
     */
    setIsSubmitting(bool, callback=null){
        this.setState({ 'isSubmitting': bool }, callback);
    }

    /**
     * Catch and alert user navigating away from page if in submission process.
     *
     * @private
     * @param {React.SyntheticEvent} e Window beforeunload event.
     * @returns {string|void} Dialog text which is to be shown to user.
     */
    handleBeforeUnload(e){
        const { isSubmitting } = this.state;
        if (isSubmitting){
            const dialogText = "Leaving will cause all unsubmitted work to be lost. Are you sure you want to proceed?";
            e.returnValue = dialogText;
            return dialogText;
        }
    }

    /**
     * Renders the entire HTML of the application.
     *
     * @private
     * @returns {JSX.Element} An `<html>` element.
     */
    render() {
        const { context, lastCSSBuildTime, href, contextRequest } = this.props;
        const hrefParts       = memoizedUrlParse(href);
        const routeList       = hrefParts.pathname.split("/");
        const routeLeaf       = routeList[routeList.length - 1];
        const currentAction   = this.currentAction();
        const userInfo = JWT.getUserInfo();
        const userActions = (userInfo && userInfo.user_actions) || null;
        let canonical = href;
        let status;

        // `canonical` is meant to refer to the definitive URI for current resource.
        // For example, https://data.4dnucleome.org/some-item, http://data.4dnucleome.org/some-item, http://www.data.4dnucleome.org/some-item
        // refer to same item, and `canonical` URL is the one that should be used when referring to or citing "/some-item".
        // In our case, it is "https://data.4dnucleome.org/"; this canonical code may be deprecated as we always redirect to https and
        // [wwww.]4dnuclome.org is a separate domain/site.

        if (context.canonical_uri) {
            if (hrefParts.host) {
                canonical = (hrefParts.protocol || '') + '//' + hrefParts.host + context.canonical_uri;
            } else {
                canonical = context.canonical_uri;
            }
        }

        // check error status

        var isPlannedSubmissionsPage = hrefParts.pathname.indexOf('/planned-submissions') > -1; // TEMP EXTRA CHECK WHILE STATIC_PAGES RETURN 404 (vs 403)

        if (context.code && (context.code === 403 || (isPlannedSubmissionsPage && context.code === 404))){
            if (isPlannedSubmissionsPage){
                status = 'forbidden';
            } else if (context.title && (context.title.toLowerCase() === 'login failure' || context.title === 'No Access')){
                status = 'invalid_login';
            } else if (context.title && context.title === 'Forbidden'){
                status = 'forbidden';
            }
        } else if (context.code && context.code === 404){
            // check to ensure we're not looking at a static page
            if (routeLeaf != 'help' && routeLeaf != 'about' && routeLeaf !== 'home' && routeLeaf !== 'submissions'){
                status = 'not_found';
            }
        } else if (routeLeaf == 'submissions' && !_.contains(_.pluck(userActions, 'id'), 'submissions')){
            status = 'forbidden'; // attempting to view submissions but it's not in users actions
        }


        // Google does not update the content of 301 redirected pages
        // We technically should never hit this condition as we redirect http to https, however leaving in
        // as not 100% certain.
        var base;
        if (canonical === 'http://data.4dnucleome.org/') {
            base = canonical = 'https://data.4dnucleome.org/';
            this.historyEnabled = false;
        }

        const isLoading = contextRequest && contextRequest.xhr && contextRequest.xhr.readyState < 4;
        const baseDomain = (hrefParts.protocol || '') + '//' + hrefParts.host;
        const bodyElementProps = _.extend({}, this.state, this.props, { // Complete set of own props, own state, + extras.
            canonical,
            baseDomain,
            isLoading,
            currentAction,
            status,
            routeLeaf,
            hrefParts,
            lastCSSBuildTime,
            'updateUploads'  : this.updateUploads,
            'updateUserInfo' : this.updateUserInfo,
            'setIsSubmitting': this.setIsSubmitting,
            'onBodyClick'    : this.handleClick,
            'onBodySubmit'   : this.handleSubmit,
        });

        // `lastCSSBuildTime` is used for both CSS and JS because is most likely they change at the same time on production from recompiling

        return (
            <html lang="en">
                <head>
                    <meta charSet="utf-8"/>
                    <meta httpEquiv="Content-Type" content="text/html, charset=UTF-8"/>
                    <meta httpEquiv="X-UA-Compatible" content="IE=edge"/>
                    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
                    <meta name="google-site-verification" content="sia9P1_R16tk3XW93WBFeJZvlTt3h0qL00aAJd3QknU" />
                    <meta name="twitter:widgets:autoload" content="off" />
                    <meta name="twitter:dnt" content="on" />
                    <HTMLTitle {...{ context, currentAction, canonical, status }} />
                    {base ? <base href={base}/> : null}
                    <link rel="stylesheet" href={'/static/css/style.css?build=' + (lastCSSBuildTime || 0)} type="text/css" />
                    <link rel="preconnect" href="https://unpkg.com" />
                    <link rel="preconnect" href="https://fonts.googleapis.com/" />
                    <link rel="preconnect" href="//www.google-analytics.com" />
                    <link rel="stylesheet" href="https://unpkg.com/rc-tabs@9.6.0/dist/rc-tabs.min.css" type="text/css" />
                    <SEO.CurrentContext {...{ context, hrefParts, baseDomain }} />
                    <link href="https://fonts.googleapis.com/css?family=Mada:200,300,400,500,600,700,900|Yrsa|Source+Code+Pro:300,400,500,600" rel="stylesheet" type="text/css"/>
                    <script defer type="application/javascript" src="//www.google-analytics.com/analytics.js" />
                    <script defer type="application/javascript" src={"/static/build/bundle.js?build=" + (lastCSSBuildTime || 0)} charSet="utf-8" />
                    <link rel="canonical" href={canonical} />
                    {/* <script data-prop-name="inline" type="application/javascript" charSet="utf-8" dangerouslySetInnerHTML={{__html: this.props.inline}}/> <-- SAVED FOR REFERENCE */}
                </head>
                <React.StrictMode>
                    <BodyElement {...bodyElementProps} />
                </React.StrictMode>
            </html>
        );
    }
}

/**
 * Renders out the <title> element in the <head> area of the
 * HTML document.
 */
class HTMLTitle extends React.PureComponent {

    componentDidMount() {
        // See https://github.com/facebook/react/issues/2323
        var node = document.querySelector('title');
        if (node && this._rootNodeID && !node.getAttribute('data-reactid')) {
            node.setAttribute('data-reactid', this._rootNodeID);
        }
    }

    render() {
        const { canonical, currentAction, context, status, contentViews } = this.props;
        const { title: portalTitle } = portalConfig;
        let title;

        if (canonical === "about:blank"){   // first case is fallback
            title = portalTitle;
        } else if (status) {                // error catching
            title = 'Error';
        } else if (context) {               // What should occur (success)

            var ContentView = (contentViews || globalContentViews).lookup(context, currentAction);

            // Set browser window title.
            title = object.itemUtil.getTitleStringFromContext(context);

            if (title && title != 'Home') {
                title = title + ' – ' + portalTitle;
            } else {
                title = portalTitle;
            }

            if (!ContentView){ // Handle the case where context is not loaded correctly
                title = 'Error';
            } else if (currentAction && _.contains(['edit', 'add', 'create'], currentAction)) { // Handle content edit + create action permissions
                const contextActionNames = _.filter(_.pluck((context && context.actions) || [], 'name'));
                // see if desired actions is not allowed for current user
                if (!_.contains(contextActionNames, currentAction)){
                    title = 'Action not permitted';
                }
            }
        } else {
            throw new Error('No context is available. Some error somewhere.');
        }

        return <title>{ title }</title>;
    }

}

class ContentRenderer extends React.PureComponent {
    render(){
        const { canonical, status, currentAction, context, routeLeaf, contentViews, href } = this.props;
        const contextAtID     = object.itemUtil.atId(context);
        const key             = contextAtID && contextAtID.split('?')[0]; // Switching between collections may leave component in place

        let content; // Output

        // Object of common props passed to all content_views.
        const commonContentViewProps = _.pick(this.props,
            // Props from App:
            'schemas', 'session', 'href', 'navigate', 'uploads', 'updateUploads',
            'browseBaseState', 'setIsSubmitting', 'updateUserInfo', 'context', 'currentAction',
            // Props from BodyElement:
            'windowWidth', 'windowHeight', 'registerWindowOnResizeHandler', 'registerWindowOnScrollHandler',
            'addToBodyClassList', 'removeFromBodyClassList', 'toggleFullScreen', 'isFullscreen'
        );

        if (canonical === "about:blank"){   // first case is fallback
            content = null;
        } else if (status) {                // error catching
            content = <ErrorPage currRoute={routeLeaf} status={status}/>;
        } else if (context) {               // What should occur (success)

            var ContentView = (contentViews || globalContentViews).lookup(context, currentAction);

            if (!ContentView){ // Handle the case where context is not loaded correctly
                content = <ErrorPage status={null}/>;
            } else if (currentAction && _.contains(['edit', 'add', 'create'], currentAction)) { // Handle content edit + create action permissions
                const contextActionNames = _.filter(_.pluck((context && context.actions) || [], 'name'));
                // see if desired actions is not allowed for current user
                if (!_.contains(contextActionNames, currentAction)){
                    content = <ErrorPage status="forbidden" />;
                }
            }

            if (!content) { // No overriding cases encountered. Proceed to render appropriate view for our context.
                content = <ContentView key={key} {...commonContentViewProps} />;
            }
        } else {
            throw new Error('No context is available. Some error somewhere.');
        }

        return <ContentErrorBoundary canonical={canonical} href={href}>{ content }</ContentErrorBoundary>;
    }
}

/**
 * This component provides some extra layout properties to certain components.
 * Namely, it handles, stores, and passes down state related to scrolling up/down the page.
 * This prevents needing to have numerous window scroll event listeners living throughout the app.
 *
 * @public
 * @class
 * @listens {Event} Window scroll events.
 * @listens {Event} Window resize events.
 * @todo Perhaps grab and pass down windowInnerWidth, windowInnerHeight, and/or similar props as well.
 */
class BodyElement extends React.PureComponent {

    /**
     * Calculates and returns width and height of viewport.
     * @returns {{ windowWidth: number, windowHeight: number }} Object with windowWidth and windowHeight properties.
     */
    static getViewportDimensions(){
        if (isServerSide()) return;
        return { 'windowWidth' : window.innerWidth , 'windowHeight' : window.innerHeight };
    }

    static getDerivedStateFromProps(props, state){
        var stateChange = { 'lastHref' : props.href };
        // Unset full screen if moving away to different pathname.
        if (state.isFullscreen && stateChange.lastHref !== state.lastHref){
            const currParts = url.parse(state.lastHref);
            const nextParts = memoizedUrlParse(stateChange.lastHref);

            if (currParts.pathname !== nextParts.pathname){
                stateChange.isFullscreen = false;
            }
        }
        return stateChange;
    }

    static isSearchPage(href){
        return (href && typeof href === "string" && href.indexOf('/search/') > -1);
    }

    /**
     * Instantiates the BodyElement component, binds functions.
     */
    constructor(props){
        super(props);
        this.onResize = _.debounce(this.onResize.bind(this), 300);
        this.setupScrollHandler = this.setupScrollHandler.bind(this);

        this.registerWindowOnResizeHandler = this.registerWindowOnResizeHandler.bind(this);
        this.registerWindowOnScrollHandler = this.registerWindowOnScrollHandler.bind(this);
        this.addToBodyClassList         = this.addToBodyClassList.bind(this);
        this.removeFromBodyClassList    = this.removeFromBodyClassList.bind(this);
        this.toggleFullScreen           = this.toggleFullScreen.bind(this);

        /**
         * State object for BodyElement.
         *
         * @type {Object}
         * @property {boolean} state.scrolledPastTop        Whether window has been scrolled past 0.
         * @property {boolean} state.scrolledPastEighty     Whether window has been scrolled past 80px.
         * @property {number} state.windowWidth             Window inner width.
         * @property {number} state.windowHeight            Window inner height.
         * @property {string[]} state.classList             List of additional classNames that are added to the body element.
         */
        this.state = {
            'scrolledPastTop'       : null,
            'scrolledPastEighty'    : null,
            //'scrollTop'             : null // Not used, too many state updates if were to be.
            'windowWidth'           : null,
            'windowHeight'          : null,
            'classList'             : [],
            'hasError'              : false,
            'errorInfo'             : null,
            'isFullscreen'          : false,
            // Because componentWillReceiveProps is deprecated in favor of (static) getDerivedStateFromProps,
            // we ironically must now clone href in state to be able to do comparisons...
            // See: https://stackoverflow.com/questions/49723019/compare-with-previous-props-in-getderivedstatefromprops
            'lastHref'              : props.href
        };

        this.memoized = {
            isSearchPage: memoize(BodyElement.isSearchPage)
        };

        /**
         * Holds event handlers for window scroll event.
         * @private
         */
        this.scrollHandlers = [];
        /**
         * Holds event handlers for window resize event.
         * @private
         */
        this.resizeHandlers = [];

        /**
         * Reference to ReactTooltip component instance.
         * Used to unset the `top` and `left` positions after hover out.
         */
        this.tooltipRef = React.createRef();

        /**
         * Reference to overlays container.
         * Used for React.createPortal in whichever components
         * may need to make one.
         *
         * Eventually, this will be used to supercede React-Bootstraps
         * Modal Components.
         */
        this.overlaysContainerRef = React.createRef();
    }

    /**
     * Initializes scroll event handler & loading of help menu tree.
     *
     * @private
     * @returns {void}
     */
    componentDidMount(){
        if (window && window.fourfront) window.fourfront.bodyElem = this;
        this.setupScrollHandler();
        window.addEventListener('resize', this.onResize);
        this.onResize();
    }

    componentDidUpdate(pastProps){
        const { href } = this.props;
        if (pastProps.href !== href){
            // Remove tooltip if still lingering from previous page
            this.tooltipRef && this.tooltipRef.current && this.tooltipRef.current.hideTooltip();
        }
    }

    /**
     * Unbinds event listeners.
     * Probably not needed but lets be safe & cleanup.
     *
     * @private
     * @returns {void}
     */
    componentWillUnmount(){
        window.removeEventListener("scroll", this.throttledScrollHandler);
        delete this.throttledScrollHandler;
        window.removeEventListener('resize', this.onResize);
    }

    /**
     * Catches exceptions in NavBar and similar 'outer' component areas.
     *
     * @private
     * @returns {void}
     */
    componentDidCatch(err, info){
        const { href } = this.props;
        this.setState({ 'hasError' : true, 'errorInfo' : info }, ()=>{
            analytics.exception('Client Error - ' + href + ': ' + err, true);
            // Unset app.historyEnabled so that user may navigate backward w/o JS.
            if (window && window.fourfront && window.fourfront.app){
                window.fourfront.app.historyEnabled = false;
            }
        });
    }

    /**
     * Function passed down as a prop to content views to register window on scroll handlers.
     *
     * @public
     * @param {function} scrollHandlerFxn - Callback function which accepts a 'scrollTop' (number) and 'scrollVector' (number) param.
     * @returns {function} A function to call to unregister newly registered handler.
     */
    registerWindowOnScrollHandler(scrollHandlerFxn){
        var exists = this.scrollHandlers.indexOf(scrollHandlerFxn);// _.findIndex(this.scrollHandlers, scrollHandlerFxn);
        if (exists > -1) {
            console.warn('Function already registered.', scrollHandlerFxn);
            return null;
        } else {
            this.scrollHandlers.push(scrollHandlerFxn);
            console.info("Registered scroll handler", scrollHandlerFxn);
            return () => {
                var idxToRemove = this.scrollHandlers.indexOf(scrollHandlerFxn);
                if (idxToRemove === -1){
                    console.warn('Function no longer registered.', scrollHandlerFxn);
                    return false;
                }
                this.scrollHandlers.splice(idxToRemove, 1);
                console.info('Unregistered function from scroll events', scrollHandlerFxn);
                return true;
            };
        }
    }


    /**
     * Function passed down as a prop to content views to register window on resize handlers.
     *
     * @public
     * @param {function} resizeHandlerFxn - Callback function which accepts a 'dims' ({ windowWidth: number, windowHeight: number }) and 'pastDims' param.
     * @returns {function} A function to call to unregister newly registered handler.
     */
    registerWindowOnResizeHandler(resizeHandlerFxn){
        var exists = this.resizeHandlers.indexOf(resizeHandlerFxn);
        if (exists > -1) {
            console.warn('Function already registered.', resizeHandlerFxn);
            return null;
        } else {
            this.resizeHandlers.push(resizeHandlerFxn);
            console.info("Registered resize handler", resizeHandlerFxn);
            return () => {
                var idxToRemove = this.resizeHandlers.indexOf(resizeHandlerFxn);
                if (idxToRemove === -1){
                    console.warn('Function no longer registered.', resizeHandlerFxn);
                    return false;
                }
                this.resizeHandlers.splice(idxToRemove, 1);
                console.info('Unregistered function from resize events', resizeHandlerFxn);
                return true;
            };
        }
    }

    /**
     * Adds param `className` to `state.classList`. Passed down through props for child components to be able to adjust
     * body className in response to user interactions, such as setting a full screen state.
     *
     * @public
     * @param {string}   className      ClassName to add to class list.
     * @param {function} [callback]     Optional callback to be executed after state change.
     * @returns {void}
     */
    addToBodyClassList(...classNames){
        let callback = classNames.pop();
        if (typeof callback !== 'function'){
            classNames.push(callback);
            callback = null;
        }
        this.setState(function({ classList }){
            const nextClassList = classList.slice(0);
            let anyAdded = false;
            classNames.forEach(function(className){
                const foundIdx = nextClassList.indexOf(className);
                if (foundIdx > -1){
                    console.warn('ClassName already set', className);
                } else {
                    nextClassList.push(className);
                    anyAdded = true;
                    console.info('Adding "' + className + '" to body classList');
                }
            });
            if (anyAdded) {
                return { "classList" : nextClassList };
            }
            return null;
        }, callback);
    }

    /**
     * Removes param `className` from `state.classList`. Passed down through props for child components to be able to adjust
     * body className in response to user interactions, such as removing a full screen state.
     *
     * @public
     * @param {string}   className      ClassName to remove from class list.
     * @param {function} [callback]     Optional callback to be executed after state change.
     * @returns {void}
     */

    removeFromBodyClassList(...classNames){
        let callback = classNames.pop();
        if (typeof callback !== 'function'){
            classNames.push(callback);
            callback = null;
        }
        this.setState(function({ classList }){

            const nextClassList = classList.slice(0);
            let anyRemoved = false;
            classNames.forEach(function(className){
                const foundIdx = nextClassList.indexOf(className);
                if (foundIdx === -1){
                    console.warn('ClassName not in list', className);
                } else {
                    nextClassList.splice(foundIdx, 1);
                    anyRemoved = true;
                    console.info('Removing "' + className + '" from body classList');
                }
            });
            if (anyRemoved) {
                return { "classList" : nextClassList };
            }
            return null;
        }, callback);
    }


    /**
     * Updates windowWidth and windowHeight dimensions in this.state, if different.
     * @private
     * @returns {void}
     */
    onResize(e){
        var dims, pastDims;
        this.setState(function(currState){
            var nextState = {};
            dims = BodyElement.getViewportDimensions();
            pastDims = _.pick(currState, 'windowWidth', 'windowHeight');
            if (dims.windowWidth !== currState.windowWidth)     nextState.windowWidth = dims.windowWidth;
            if (dims.windowHeight !== currState.windowHeight)   nextState.windowHeight = dims.windowHeight;
            if (_.keys(nextState).length > 0){
                return nextState;
            }
            return null;
        }, ()=>{
            console.info('Window resize detected.', dims);
            if (this.resizeHandlers.length > 0){
                _.forEach(this.resizeHandlers, (resizeHandlerFxn) => resizeHandlerFxn(dims, pastDims, e) );
            }
        });
    }

    /**
     * Attaches event listeners to the `window` object and passes down 'registerOnWindowEvent' functions as props which children down the rendering tree can subscribe to.
     * Updates `state.scrolledPastTop` and `<body/>` element className depending on window current scroll top.
     *
     * @private
     * @listens {Event} Window scroll events.
     * @returns {void}
     */
    setupScrollHandler(){
        if (!(typeof window !== 'undefined' && window && document && document.body && typeof document.body.scrollTop !== 'undefined')){
            return null;
        }

        let lastScrollTop = 0;
        const handleScroll = (e) => {
            const currentScrollTop = layout.getPageVerticalScrollPosition();
            const scrollVector = currentScrollTop - lastScrollTop;

            lastScrollTop = currentScrollTop;

            if (this.scrollHandlers.length > 0){
                _.forEach(this.scrollHandlers, (scrollHandlerFxn) => scrollHandlerFxn(currentScrollTop, scrollVector, e) );
            }

            this.setState(function({ windowWidth, scrolledPastTop, scrolledPastEighty }){
                const rgs = layout.responsiveGridState(windowWidth);
                let nextScrolledPastTop;
                let nextScrolledPastEighty;

                if ( // Fixed nav takes effect at medium grid breakpoint or wider.
                    ['xs','sm'].indexOf(rgs) === -1 && (
                        (currentScrollTop > 20 && scrollVector >= 0) ||
                        (currentScrollTop > 80)
                    )
                ){
                    nextScrolledPastTop = true;
                    if (currentScrollTop > 80){
                        nextScrolledPastEighty = true;
                    }
                } else {
                    nextScrolledPastTop = false;
                    nextScrolledPastEighty = false;
                }

                if (nextScrolledPastTop === scrolledPastTop && nextScrolledPastEighty === scrolledPastEighty){
                    return null;
                }

                return {
                    "scrolledPastTop" : nextScrolledPastTop,
                    "scrolledPastEighty" : nextScrolledPastEighty
                };
            });
        };

        // We add as property of class instance so we can remove event listener on unmount, for example.
        this.throttledScrollHandler = _.throttle(raf.bind(window, handleScroll), 10);

        window.addEventListener("scroll", this.throttledScrollHandler);
        setTimeout(this.throttledScrollHandler, 100, null);
    }

    toggleFullScreen(isFullscreen, callback){
        if (typeof isFullscreen === 'boolean'){
            this.setState({ isFullscreen }, callback);
        } else {
            this.setState(function(currState){
                return { 'isFullscreen' : !currState.isFullscreen };
            }, callback);
        }
    }

    renderErrorState(){
        return (
            <body>
                <div id="slot-application">
                    <div id="application" className="done error">
                        <div id="layout">
                            <div id="pre-content-placeholder"/>
                            { ContentErrorBoundary.errorNotice() }
                            <div id="layout-footer"/>
                        </div>
                    </div>
                </div>
            </body>
        );
    }

    bodyClassName(){
        const { isLoading, context, currentAction, href } = this.props;
        const { scrolledPastEighty, scrolledPastTop, classList, isFullscreen } = this.state;
        const bodyClassList = (classList && classList.slice(0)) || [];
        const isSelectPage = isSelectAction(currentAction) && this.memoized.isSearchPage(href);

        // Common UI
        if (isLoading)              bodyClassList.push("loading-request");
        if (scrolledPastTop)        bodyClassList.push("scrolled-past-top");
        if (scrolledPastEighty)     bodyClassList.push("scrolled-past-80");
        if (isSelectPage)           bodyClassList.push("is-select-page");
        if (isFullscreen)           bodyClassList.push("is-full-screen");

        // TODO migrate test-warning-visible class to here from NavBar (done on CGAP already).

        // If is a typical ItemView, we want to show a full-width view.
        // StaticPages, unless on ItemView for them, _do not_ contain "Item"
        // in their @type field and instead have Portal, StaticPage, etc.
        if (Array.isArray(context['@type'])){
            if (context['@type'].indexOf('Item') > -1){
                bodyClassList.push("is-item-view");
            }
        }

        if (bodyClassList.length > 0){
            return bodyClassList.join(' ');
        } else {
            return null;
        }
    }

    /** Renders out the body layout of the application. */
    render(){
        const { onBodyClick, onBodySubmit, context, alerts, canonical, currentAction, href, hrefParts, slowLoad, session, schemas, updateUserInfo, browseBaseState, lastCSSBuildTime } = this.props;
        const { windowWidth, windowHeight, hasError, isFullscreen } = this.state;
        const { registerWindowOnResizeHandler, registerWindowOnScrollHandler, addToBodyClassList, removeFromBodyClassList, toggleFullScreen } = this;
        const appClass = slowLoad ? 'communicating' : 'done';
        const overlaysContainer = this.overlaysContainerRef.current;
        const isSelectPage = isSelectAction(currentAction) && this.memoized.isSearchPage(href);

        if (hasError) return this.renderErrorState();

        const navbarProps = {
            href, context, currentAction, hrefParts, session, schemas,
            browseBaseState, updateUserInfo, addToBodyClassList, removeFromBodyClassList,
            windowWidth, windowHeight, isFullscreen, overlaysContainer
        };

        return (
            <body data-current-action={currentAction} onClick={onBodyClick} onSubmit={onBodySubmit} data-path={hrefParts.path}
                data-pathname={hrefParts.pathname} className={this.bodyClassName()}>

                <script data-prop-name="lastCSSBuildTime" type="application/json" dangerouslySetInnerHTML={{ __html: lastCSSBuildTime }}/>

                <script data-prop-name="user_details" type="application/json" dangerouslySetInnerHTML={{
                    __html: jsonScriptEscape(JSON.stringify(JWT.getUserDetails())) /* Kept up-to-date in browser.js */
                }}/>

                <script data-prop-name="context" type="application/json" dangerouslySetInnerHTML={{
                    __html: jsonScriptEscape(JSON.stringify(context))
                }}/>
                <script data-prop-name="alerts" type="application/json" dangerouslySetInnerHTML={{
                    __html: jsonScriptEscape(JSON.stringify(alerts))
                }}/>

                <div id="slow-load-container" className={slowLoad ? 'visible' : null}>
                    <div className="inner">
                        <i className="icon icon-circle-notch fas"/>
                    </div>
                </div>

                <div id="slot-application">
                    <div id="application" className={appClass}>
                        <div id="layout">

                            <NavigationBar {...navbarProps} />

                            {!isSelectPage ? <div id="pre-content-placeholder" /> : null}

                            <PageTitleSection {...this.props} windowWidth={windowWidth} />

                            <div id="facet-charts-container" className="container">
                                <FacetCharts {..._.pick(this.props, 'context', 'href', 'session', 'schemas', 'browseBaseState')}
                                    {...{ windowWidth, windowHeight, navigate, isFullscreen }} />
                            </div>

                            <ContentErrorBoundary canonical={canonical} href={href}>
                                <ContentRenderer { ...this.props } { ...{ windowWidth, windowHeight, navigate, registerWindowOnResizeHandler,
                                    registerWindowOnScrollHandler, addToBodyClassList, removeFromBodyClassList, toggleFullScreen, isFullscreen,
                                    overlaysContainer } } />
                            </ContentErrorBoundary>

                            <div id="layout-footer"/>
                        </div>
                        {!isSelectPage ? <Footer version={context.app_version} /> : null}
                    </div>
                </div>

                <div id="overlays-container" key="overlaysContainer" ref={this.overlaysContainerRef}/>

                <ReactTooltip effect="solid" ref={this.tooltipRef} globalEventOff="click" key="tooltip" />

            </body>
        );
    }

}







class ContentErrorBoundary extends React.Component {

    static errorNotice(){
        return (
            <div className="error-boundary container" id="content">
                <hr/>
                <div className="mb-2 mt-2">
                    <h3 className="text-400">A client-side error has occured, please go back or try again later.</h3>
                </div>
            </div>
        );
    }

    constructor(props){
        super(props);
        this.state = {
            'hasError' : false,
            'errorInfo' : null
        };
    }

    componentDidCatch(err, info){
        const { href } = this.props;
        this.setState({ 'hasError' : true, 'errorInfo' : info }, ()=>{
            analytics.exception('Client Error - ' + href + ': ' + err, true);
        });
    }

    /**
     * Unsets the error state if we navigate to a different view/href .. which normally should be different ContentView.
     */
    componentDidUpdate(pastProps){
        const { canonical } = this.props;
        if (pastProps.canonical !== canonical){
            this.setState(function(currState){
                if (currState.hasError) {
                    return {
                        'hasError' : false,
                        'errorInfo' : null
                    };
                }
                return {};
            });
        }
    }

    render(){
        const { children } = this.props, { hasError } = this.state;
        if (hasError){
            return ContentErrorBoundary.errorNotice();
        }
        return children;
    }
}
