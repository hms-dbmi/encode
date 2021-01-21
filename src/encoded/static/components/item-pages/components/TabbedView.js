'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import _ from 'underscore';
import url from 'url';
import memoize from 'memoize-one';

import Tabs from 'rc-tabs';
import TabContent from 'rc-tabs/lib/TabContent';
import ScrollableInkTabBar from 'rc-tabs/lib/ScrollableInkTabBar';

import { navigate, analytics, memoizedUrlParse } from '@hms-dbmi-bgm/shared-portal-components/es/components/util';
import { UserContentBodyList } from './../../static-pages/components/UserContentBodyList';
import { standardizeUserIconString } from '@hms-dbmi-bgm/shared-portal-components/es/components/static-pages/standardizeUserIconString';


/** This file/component is specific to 4DN portal */

export function getIconForCustomTab(tabName){
    switch(tabName){
        case 'summary':
        case 'overview':
        case 'experiment-summaries':
        case 'experiment_summaries':
            return 'file-alt far';
        case 'data_processing':
            return 'chart-area fas';
        case 'processed_files':
            return 'microchip fas';
        case 'higlass':
        case 'higlass_displays':
            return 'tv fas';
        default:
            return null;
    }
}

export function getTitleForCustomTab(tabName){
    switch(tabName){
        case 'experiment-summaries':
            return 'Experiment Summaries';
        case 'higlass':
            return 'HiGlass';
        case 'higlass_displays':
            return 'HiGlass Displays';
        default:
            return null; // Fallback: Will convert tabKey _ to " " and capitalize words.
    }
}

/**
 * gets all static content from context having tabLocation as location (e.g. tab:expsets-table, tab:overview ...)
 */
export const getTabStaticContent = memoize(function (context, tabLocation) {
    if (context && context.static_content && Array.isArray(context.static_content) && typeof tabLocation === 'string') {
        const staticContent = _.pluck(_.filter(context.static_content || [], function (s) {
            return s.content && !s.content.error && s.location === tabLocation;
        }), 'content');
        return staticContent;
    }

    return [];
});

/**
 * @prop {Object[]} contents - List of objects for tabs containing 'tab', 'content', and maybe 'key'.
 */

export class TabbedView extends React.PureComponent {

    static getDefaultActiveKeyFromContents(contents){
        var defaultActiveTab = _.findWhere(contents, { 'isDefault' : true });
        if (typeof defaultActiveTab !== 'undefined' && typeof defaultActiveTab.key !== 'undefined'){
            return defaultActiveTab.key;
        }
        if (contents.length > 0){
            return contents[0].key;
        }
        return null;
    }

    static renderTabPane(tabObj, tabIndex = 0){
        const { key, tab, placeholder, disabled = false, style = null, content } = tabObj;

        return (
            <Tabs.TabPane
                key={key || tabIndex}
                data-tab-key={key}
                id={'tab:' + key}
                tab={<span className="tab" data-tab-key={key}>{ tab }</span>}
                placeholder={placeholder || <TabPlaceHolder/> }
                disabled={disabled} style={style}>
                <TabErrorBoundary tabKey={key}>{ content }</TabErrorBoundary>
            </Tabs.TabPane>
        );
    }

    static createTabObject(key, title, icon, tabContent, extraProps = {}){
        return {
            'key' : key,
            'tab' : (
                <span>
                    { icon ? <React.Fragment><i className={"icon icon-fw icon-" + icon}/> </React.Fragment> : null }
                    { title }
                </span>
            ),
            'content' : (
                <div className="overflow-hidden">
                    <h3 className="tab-section-title">{ title }</h3>
                    <hr className="tab-section-title-horiz-divider mb-1"/>
                    <UserContentBodyList contents={_.pluck(tabContent, 'content')} {...extraProps} />
                </div>
            )
        };
    }

    static calculateAdditionalTabs = memoize(function(staticContentList, contents){

        // If func, run it to return contents.
        // Do this here so that memoization is useful, else will always be new instance
        // of a `contents` array.
        if (typeof contents === 'function') contents = contents();


        var resultArr = [];
        //
        // PART 1
        // Content grouped by 'tab:some_title' is put into new tab with 'Some Title' as title.
        //

        var existingTabKeys = _.pluck(contents, 'key'),
            staticTabContent = _.filter(staticContentList, function(s){
                return s.content && !s.content.error && typeof s.location === 'string' && s.location.slice(0,4) === 'tab:';
            });

        // Filter down to locations which don't already exist in our tabs.
        staticTabContent = _.filter(
            _.map(staticTabContent, function(s){
                var splitLocation   = s.location.split(':'),
                    tabKey          = splitLocation.slice(1).join(':'); // This could have more ':'s in it, theoretically.
                return _.extend({ tabKey }, s);
            }),
            function(s){
                return existingTabKeys.indexOf(s.tabKey) === -1;
            }
        );

        var groupedContent = _.groupBy(staticTabContent, 'tabKey');

        _.forEach(_.pairs(groupedContent), function([ tabKey, contentForTab ]){

            var tabTitle, icon;

            tabTitle = contentForTab.title || getTitleForCustomTab(tabKey);
            if (!tabTitle){ // Auto-generate one from key
                tabTitle = _.map(
                    tabKey.split('_'),
                    function(str){
                        return str.charAt(0).toUpperCase() + str.slice(1);
                    }
                ).join(' ');
            }

            icon = contentForTab.icon || getIconForCustomTab(tabKey);

            resultArr.push(TabbedView.createTabObject(tabKey, tabTitle, icon, contentForTab));
        });

        //
        // PART 2
        // Content with position : 'tab' gets its own tab.
        //

        const staticTabContentSingles = _.filter(staticContentList, function(s){
            return s.content && !s.content.error && s.location === 'tab';
        });


        staticTabContentSingles.forEach(function(s, idx){
            const { content : { title = null, options : { title_icon = null } = {} } } = s;
            const useTitle = title || 'Custom Tab ' + (idx + 1);
            const tabKey = useTitle.toLowerCase().split(' ').join('_');
            const icon = standardizeUserIconString(title_icon);
            resultArr.push(TabbedView.createTabObject(tabKey, title, icon, [s], { 'hideTitles' : true }));
        });

        return resultArr;
    });

    static combineSystemAndCustomTabs = memoize(function(additionalTabs, contents){
        if (typeof contents === 'function') contents = contents();
        var allTabs;
        if (additionalTabs.length === 0){
            allTabs = contents;
        } else {
            var addBeforeTabs   = ['details', 'attribution'],
                addIdx          = _.findIndex(contents, function(t){ return addBeforeTabs.indexOf(t.key) > -1; });

            if (typeof addIdx !== 'number'){
                allTabs = contents.concat(additionalTabs);
            } else {
                allTabs = contents.slice(0);
                allTabs.splice(addIdx, 0, ...additionalTabs);
            }
        }
        return allTabs;
    });

    static propTypes = {
        'contents' : PropTypes.oneOfType([PropTypes.func, PropTypes.arrayOf(PropTypes.shape({
            'tab'       : PropTypes.oneOfType([PropTypes.string, PropTypes.element]).isRequired,
            'content'   : PropTypes.element.isRequired,
            'key'       : PropTypes.string.isRequired,
            'disabled'  : PropTypes.bool
        }))  ]).isRequired,
        'href' : PropTypes.string.isRequired
    };

    static defaultProps = {
        'contents' : [
            { tab : "Tab 1", content : <span>Test1</span>, key : 'tab-id-1' },
            { tab : "Tab 2", content : <span>Test2</span>, key : 'tab-id-2' }
        ],
        'animated' : false,
        'destroyInactiveTabPane' : false // Maybe make true? Need to profile performance
    };

    constructor(props){
        super(props);
        this.getActiveKey = this.getActiveKey.bind(this);
        this.setActiveKey = this.setActiveKey.bind(this);
        this.maybeSwitchTabAccordingToHref = this.maybeSwitchTabAccordingToHref.bind(this);
        this.onTabClick = this.onTabClick.bind(this);

        this.tabsRef = React.createRef();
    }

    componentDidMount(){
        this.maybeSwitchTabAccordingToHref();
    }

    componentDidUpdate(pastProps, pastState){
        if (pastProps.href !== this.props.href){
            this.maybeSwitchTabAccordingToHref();
        }
    }

    getActiveKey(){
        var tabsInstance = this.tabsRef.current,
            currKey = tabsInstance && tabsInstance.state.activeKey;

        return currKey;
    }

    setActiveKey(nextKey){
        var tabsInstance = this.tabsRef.current;
        if (typeof tabsInstance.setActiveKey === 'function'){
            return tabsInstance.setActiveKey(nextKey);
        } else {
            console.error('Manually setting active tab key not currently supported...');
            return false;
        }
    }

    maybeSwitchTabAccordingToHref(props = this.props){
        const { contents, href } = props;
        const hrefParts = memoizedUrlParse(href);
        const hash = typeof hrefParts.hash === 'string' && hrefParts.hash.length > 0 && hrefParts.hash.slice(1);
        const currKey = this.getActiveKey();

        if (currKey === hash){
            console.log('Already on tab', hash);
            return false;
        }

        const allContentObjs = hash && TabbedView.combineSystemAndCustomTabs(this.additionalTabs(), contents);
        const foundContent = Array.isArray(allContentObjs) && _.findWhere(allContentObjs, { 'key' : hash });

        if (!foundContent){
            console.error('Could not find', hash);
            return false;
        }

        this.setActiveKey(foundContent.key); // Same as `hash`
        return true;
    }

    onTabClick(tabKey, evt){
        var { onTabClick } = this.props;

        // We add 'replace: true' to replace current Browser History entry with new entry.
        // Entry will refer to same pathname but different hash.
        // This is so people don't need to click 'back' button 10 times to get to previous /search/ or /browse/ page for example,
        // since they might browse around tabs for some time.
        navigate('#' + tabKey, { 'skipRequest' : true, 'dontScrollToTop' : true, 'replace' : true });

        if (typeof onTabClick === 'function'){
            return onTabClick(tabKey, evt);
        }
    }

    additionalTabs(){
        const { context, contents } = this.props;
        const staticContentList = (Array.isArray(context.static_content) && context.static_content.length > 0 && context.static_content) || [];

        if (staticContentList.length === 0) return []; // No content defined for Item.

        return TabbedView.calculateAdditionalTabs(staticContentList, contents);
    }

    render(){
        const { contents, extraTabContent, activeKey, animated, onChange, destroyInactiveTabPane, renderTabBar, windowWidth } = this.props;

        const allTabs = TabbedView.combineSystemAndCustomTabs(this.additionalTabs(), contents);
        const tabsProps = {
            onChange, destroyInactiveTabPane,
            'renderTabBar': () => (
                <ScrollableInkTabBar onTabClick={this.onTabClick} extraContent={extraTabContent}
                    className="extra-style-2" tabBarGutter={0} />
            ),
            'renderTabContent': () => <TabContent animated={animated} />,
            'ref': this.tabsRef,
            'defaultActiveKey': TabbedView.getDefaultActiveKeyFromContents(contents),
            'children': _.map(allTabs, TabbedView.renderTabPane)
        };

        if (activeKey) tabsProps.activeKey = activeKey;

        return <Tabs {...tabsProps} key="tabs" />;
    }

}

class TabPlaceHolder extends React.PureComponent {
    render(){
        return (
            <div>
                <h3 className="text-400 mb-5 mt-5">
                    <i className="icon icon-spin fas icon-circle-notch"/>
                </h3>
            </div>
        );
    }
}




/**
 * Error Boundary component to wrap an individual tab in a page.
 */
class TabErrorBoundary extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            'hasError': false,
            'errorInfo': null
        };
    }

    componentDidCatch(err, info) {
        const { tabKey } = this.props;
        this.setState({ 'hasError': true, 'errorInfo': info }, () => {
            // `window` is only available when we're mounted / client-side.
            const href = (window && window.location.href) || "(Unknown URL)";
            analytics.exception('Client Error - ' + href + ' (#' + tabKey + '): ' + err, true);
        });
    }

    componentDidUpdate(pastProps) {
        const { tabKey } = this.props;
        if (pastProps.tabKey !== tabKey) {
            this.setState(function ({ hasError }) {
                if (hasError) {
                    return {
                        'hasError': false,
                        'errorInfo': null
                    };
                }
                return null;
            });
        }
    }

    render() {
        const { children } = this.props;
        const { hasError } = this.state;
        if (hasError) {
            return (
                <div className="error-boundary container">
                    <div className="mb-2 mt-2">
                        <h3 className="text-400">A client-side error has occured, tab content cannot be rendered correctly.</h3>
                    </div>
                </div>
            );
        }
        return children;
    }
}


