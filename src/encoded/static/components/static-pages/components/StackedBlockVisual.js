'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import _ from 'underscore';
import { Collapse, Popover, OverlayTrigger } from 'react-bootstrap';
import ReactTooltip from 'react-tooltip';
import { console, object } from'./../../util';


export function groupByMultiple(objList, propertiesList){

    var maxDepth = (propertiesList || []).length - 1;

    return (function doGroup(list, depth){
        var groupedLists = _.groupBy(list, propertiesList[depth]);
        if (depth < maxDepth){
            _.keys(groupedLists).forEach(function(k){
                groupedLists[k] = doGroup(groupedLists[k], depth + 1);
            });
        }
        return groupedLists;
    })(objList, 0);

}

/**
 * Taken from https://stackoverflow.com/questions/15298912/javascript-generating-combinations-from-n-arrays-with-m-elements
  */
export function cartesian() {
    var r = [], arg = arguments, max = arg.length-1;
    function helper(arr, i) {
        for (var j=0, l=arg[i].length; j<l; j++) {
            var a = arr.slice(0); // clone arr
            a.push(arg[i][j]);
            if (i==max)
                r.push(a);
            else
                helper(a, i+1);
        }
    }
    helper([], 0);
    return r;
}

export function extendListObjectsWithIndex(objList){
    return _.map(objList || [], function(o, idx){
        return _.extend({ 'index' : idx }, o);
    });
}

export function sumPropertyFromList(objList, property){
    function getCount(num){
        try {
            var n = parseInt(num);
            if (isNaN(n)) return 0;
            return n;
        } catch (e){
            return 0;
        }
    }

    if (Array.isArray(objList)) {
        return _.reduce(objList, function(m,v){
            return m + getCount(object.getNestedProperty(v, property));
        }, 0);
    } else {
        throw new Error('Not an array');
    }
}



export class StackedBlockVisual extends React.Component {

    static defaultProps = {
        'groupingProperties' : ['grant_type', 'center_name',  'lab_name'],
        'columnGrouping' : null,
        'blockHeight' : 35,
        'blockVerticalSpacing' : 5,
        'blockHorizontalSpacing' : 5,
        'duplicateHeaders' : true,
        'collapseToMatrix' : false,
        // @param data may be either Array (if multiple grouped into 1) or object.
        'showGroupingPropertyTitles' : false,
        'blockClassName' : function(data){

            var isMultipleClass = 'single-set';

            if (Array.isArray(data)) {
                if (data.length > 1) {
                    isMultipleClass = 'multiple-sets';
                } else {
                    isMultipleClass = 'single-set';
                }
            }

            return isMultipleClass;
        },
        'blockTooltipContents' : function(data, groupingTitle, groupingPropertyTitle, props){


            var tip = null;

            if (Array.isArray(data) && data.length === 1) data = data[0];

            if (props.title){
                tip = '<h5 style="min-width: 300px;">';
                tip += props.title;
                tip += '</h5>';
            } else if (groupingPropertyTitle){
                tip = '<h5>';
                tip += '<span class="text-300">' + groupingPropertyTitle + (groupingTitle ? ':' : '') + '</span>';
                if (groupingTitle) tip += ' ' + groupingTitle;
                tip += '</h5>';
            } else {
                // Single planned exp set
                tip = '';
            }

            if (!Array.isArray(data)){
                if (tip && tip.length > 0){
                    tip += '<hr class="mb-1 mt-1"/>';
                } else {
                    tip = '';
                }
                tip += '<div style="min-width: 300px;">';
                tip += StackedBlockVisual.writeTipPropertiesFromJSONObject(_.omit(data, 'index'), props);
                tip += '</div>';
            } else {
                if (tip && tip.length > 0){
                    tip += '<hr class="mb-1 mt-1"/>';
                } else {
                    tip = '';
                }

                tip += '<h5 class="text-500 mb-05">' + data.length + ' Sets</h5>';
            }

            return tip;
        },
        'blockRenderedContents' : function(data, groupingTitle, groupingPropertyTitle){

            var defaultOutput = <span>&nbsp;</span>;
            var experimentsCountExpected = 0;

            function getCount(num){
                try {
                    var n = parseInt(num);
                    if (isNaN(n)) return 0;
                    return n;
                } catch (e){
                    return 0;
                }
            }

            if (Array.isArray(data)) {
                experimentsCountExpected = sumPropertyFromList(data, 'experiments_expected_2017');
            } else if (data) {
                experimentsCountExpected = getCount(data.experiments_expected_2017);
            }

            return experimentsCountExpected || defaultOutput;

        },
        'groupValue' : function(data, groupingTitle, groupingPropertyTitle){
            return sumPropertyFromList(StackedBlockGroupedRow.flattenChildBlocks(data), 'experiments_expected_2017');
        }
    }

    static minColumnWidth(props){
        return (props.blockHeight + (props.blockHorizontalSpacing * 2)) + 1;
    }

    static writeTipPropertiesFromJSONObject(d, props){
        var out = '';

        _.forEach(_.keys(d), function(property){
            var val = d[property];
            if (!val) return;

            var boldIt = (
                (props.groupingProperties && props.groupingProperties.indexOf(property) > -1) ||
                (props.columnGrouping && props.columnGrouping === property)
            );

            out += '<div class="row">';

            out += '<div class="col-xs-6">';
            out += '<div class="text-500 text-ellipsis-container text-right">' + ((props.titleMap && props.titleMap[property]) || property) + (val ? ':' : '') + '</div>';
            out += '</div>';

            if (val){
                out += '<div class="col-xs-6">';
                out += ' ';
                if (boldIt) out += '<b>';
                out += val;
                if (boldIt) out += '</b>';
                out += '</div>';
            }

            out += '</div>';
        });

        return out;
    }

    static generatePopoverRowsFromJSON(d, props){
        var out = [];

        _.forEach(_.keys(d), function(property){
            var val = d[property];
            if (!val) return;

            var boldIt = (
                (props.groupingProperties && props.groupingProperties.indexOf(property) > -1) ||
                (props.columnGrouping && props.columnGrouping === property)
            );

            if (typeof val === 'object'){
                if (object.isAnItem(val)) {
                    val = object.itemUtil.generateLink(val, true, property);
                } else if (val.props && val.type) {
                    // Do nothing.
                } else {
                    val = <code>{ JSON.stringify(val) }</code>;
                }
            }

            var rowElem = (
                <div className="row popover-entry mb-07" key={property}>
                    <div className="col-xs-5 col-md-4">
                        <div className="text-500 text-ellipsis-continer text-right">
                            { ((props.titleMap && props.titleMap[property]) || property) + (val ? ':' : '') }
                        </div>
                    </div>
                    <div className={"col-xs-7 col-md-8" + (boldIt ? ' text-600' : '')}>{ val }</div>
                </div>
            );

            out.push(rowElem);
        });

        return out;
    }

    static aggregateObjectFromList(dataList, keysToShow){

        if (!keysToShow) keysToShow = _.keys(dataList[0]);
    
        var moreData = _.reduce(dataList, function(m, o){
            for (var i = 0; i < keysToShow.length; i++){
                if (m[keysToShow[i]] === null){
                    m[keysToShow[i]] = new Set();
                }
                m[keysToShow[i]].add(o[keysToShow[i]]);
            }
            return m;
        }, _.object(_.zip(keysToShow, [].fill.call({ length : keysToShow.length }, null, 0, keysToShow.length))) );

        _.forEach(_.keys(moreData), function(k){
            if (k === 'additional_comments'){
                delete moreData[k]; // Don't show when multiple, too long.
                return;
            }
            moreData[k] = _.filter(_.uniq(Array.from(moreData[k])), function(d){ return d; });
            if (moreData[k].length === 0){
                delete moreData[k];
            } else if (moreData[k].length > 1){
                var remainingLength = moreData[k].length - 3;
                if (_.any(moreData[k], function(md){ return md && typeof md === 'object'; })){
                    moreData[k] = <span>(<span className="text-500">{ moreData[k].length }</span> Objects)</span>; // Only handle strings, ints.
                    return;
                }
                moreData[k] = (
                    <div>
                        <span className="text-600">({ moreData[k].length })</span>
                        <ol>
                            { _.map(moreData[k].slice(0,3), (v,i)=> <li key={i}>{ v }</li> ) }
                        </ol>
                        { remainingLength > 0 ? <div className="more-items-count"> and { remainingLength } more...</div> : null }
                    </div>
                );
            } else {
                moreData[k] = moreData[k][0];
            }
        });

        return moreData;

    }

    constructor(props){
        super(props);
        this.componentDidMount = this.componentDidMount.bind(this);
        this.componentWillUnmount = this.componentWillUnmount.bind(this);
        //this.toggleGroupingOpen = this.toggleGroupingOpen.bind(this);
        this.renderContents = this.renderContents.bind(this);

        var state = {
            'mounted' : true
        };

        /*
        var maxCollapsibleDepth = props.groupingProperties.length - 1;
        var unique_open_keys = [];

        _.forEach(props.groupingProperties.slice(0, maxCollapsibleDepth), function(property){
            var values = _.uniq(_.pluck(props.data, property));
            unique_open_keys.push(values);
        });

        var unique_open_keys_full = unique_open_keys[0].slice(0);

        for (var sliceEnd = 2; sliceEnd <= maxCollapsibleDepth; sliceEnd++){
            unique_open_keys_full = unique_open_keys_full.concat(_.map(cartesian.apply(cartesian, unique_open_keys.slice(0, sliceEnd)), function(keySet){
                return keySet.join('~');
            }));
        }

        _.forEach(unique_open_keys_full, function(comboKey){
            if (props && Array.isArray(props.defaultOpenKeys) && props.defaultOpenKeys.indexOf(comboKey) > -1) {
                state['open_' + comboKey] = true;
            } else {
                state['open_' + comboKey] = false;
            }
        });
        */

        this.state = state;
    }

    componentDidMount(){
        this.setState({ 'mounted' : true });
    }

    componentWillUnmount(){
        this.setState({ 'mounted' : false });
    }

    render(){
        
        return (
            <div className={"stacked-block-viz-container" + (this.props.duplicateHeaders ? ' with-duplicated-headers' : '')} ref="container">
                { this.renderContents(this.refs && this.refs.container && this.refs.container.offsetWidth) }
            </div>
        );
    }

    renderContents(width){
        if (!this.state || !this.state.mounted) return null;
        var { data, titleMap, groupingProperties, columnGrouping } = this.props;

        data = extendListObjectsWithIndex(data);

        var nestedData = groupByMultiple( data, groupingProperties ); // { 'Grant1' : { Lab1: { PI1: [...], PI2: [...] }, Lab2: {} } }
        var columnGroups = null;
        if (typeof columnGrouping === 'string'){
            columnGroups = _.groupBy(data, columnGrouping);
            if (_.keys(columnGroups) < 2) {
                columnGroups = null;
            } else {
                _.keys(columnGroups).forEach(function(k){
                    columnGroups[k] = _.pluck(columnGroups[k], 'index');
                });
            }
        }

        if (!Array.isArray(nestedData) && nestedData) {
            var leftAxisKeys = _.keys(nestedData);
            leftAxisKeys.sort();
            return _.map(leftAxisKeys, (k, idx)=>{
                return <StackedBlockGroupedRow {...this.props} groupedDataIndices={columnGroups} parentState={this.state} data={nestedData[k]} key={k} group={k} width={width} depth={0} index={idx} toggleGroupingOpen={this.toggleGroupingOpen} />;
            });
        } else {
            // TODO: Render ... plain blocks w/o left column?
        }
        
    }

}

export class StackedBlockGroupedRow extends React.Component {

    static flattenChildBlocks(groups){
        if (Array.isArray(groups)) return groups;
        return _.reduce(_.pairs(groups), function(m, pair){
            if (Array.isArray(pair[1])) return m.concat(pair[1]);
            else return m.concat(StackedBlockGroupedRow.flattenChildBlocks(pair[1]));
        }, []);
    }

    static  sortByArray(array1, arrayToSortBy){

        var o = _.object(
            _.map(array1, function(k){ return [k, true]; })
        );

        var orderedList = [];
        for (var i = 0; i < arrayToSortBy.length; i++){
            if (arrayToSortBy[i] && o[arrayToSortBy[i]]){
                orderedList.push(arrayToSortBy[i]);
                delete o[arrayToSortBy[i]];
            }
        }

        return orderedList.concat( _.keys(o)); // Incl remaining keys.
    }

    static collapsedChildBlocks(data, props, widthAvailable){

        var allChildBlocksPerChildGroup = null;
        var allChildBlocks = null;

        if (Array.isArray(data)){
            allChildBlocks = data;
        } else {
            allChildBlocks = StackedBlockGroupedRow.flattenChildBlocks(data);
        }
        
        if (typeof props.columnSubGrouping !== 'string' && !Array.isArray(data)) {
            allChildBlocksPerChildGroup = _.map(_.pairs(data), function(pair){
                return [pair[0], StackedBlockGroupedRow.flattenChildBlocks(pair[1])];
            });
            //console.log('TESTING COLLAPSE', data, allChildBlocksPerChildGroup)
        }

        //console.log('ALLCHILDBLOCKS', data, allChildBlocksPerChildGroup, allChildBlocks, props)
        
        var commonProps = _.pick(props, 'blockHeight', 'blockHorizontalSpacing', 'blockVerticalSpacing',
            'groupingProperties', 'depth', 'titleMap', 'blockClassName', 'blockRenderedContents',
            'blockTooltipContents', 'groupedDataIndices', 'headerColumnsOrder', 'columnGrouping', 'blockPopover');

        var inner = null;
        var groupedDataIndicesPairs = (props.groupedDataIndices && _.pairs(props.groupedDataIndices)) || [];


        if (groupedDataIndicesPairs.length > 0){ // If columns exist, distribute these blocks by column! Otherwise (else statement @ end) we'll probably just stack em left-to-right.

            var blocksByColumnGroup, columnKeys, widthPerColumn = (props.blockHeight + (props.blockHorizontalSpacing * 2)) + 1;

            //console.log('TEsT',allChildBlocksPerChildGroup);

            if (allChildBlocksPerChildGroup){
                // Generate block per each child or child group when nothing else to regroup by.

                blocksByColumnGroup = _.object(_.map(groupedDataIndicesPairs, function(pair){
                    var listOfIndicesForGroup = pair[1];
                    return [
                        pair[0],
                        _.filter(_.map(allChildBlocksPerChildGroup, function(cPair){
                            if (Array.isArray(cPair[1])){
                                var res = _.filter(cPair[1], function(cBlock){ return listOfIndicesForGroup.indexOf(cBlock.index) > -1; });
                                if (res.length > 0) return [cPair[0], res];
                                if (res.length === 0) return null;
                            } else if (listOfIndicesForGroup.indexOf(cPair[1].index) > -1){
                                return [cPair[0], [cPair[1]]];
                            } else return null;
                        }), function(block){ return block !== null; })];
                }));

                //console.log('BLOCKSBYCOLGROUP', blocksByColumnGroup);

                columnKeys = _.keys(blocksByColumnGroup);
                if (Array.isArray(props.headerColumnsOrder)){
                    columnKeys = StackedBlockGroupedRow.sortByArray(columnKeys, props.headerColumnsOrder);
                }

                inner = columnKeys.map(function(k){
                    return (
                        <div
                            className="block-container-group"
                            style={{
                                width : widthPerColumn,
                                minHeight : props.blockHeight + (props.blockVerticalSpacing),
                                paddingLeft : props.blockHorizontalSpacing,
                                paddingRight : props.blockHorizontalSpacing,
                                paddingTop : props.blockVerticalSpacing
                            }}
                            key={k}
                            data-group-key={k}
                            children={_.map(blocksByColumnGroup[k], (pairs,i) => <StackedBlock key={pairs[0] || i} {...commonProps} data={pairs[1]} title={pairs[0]} /> )}
                        />
                    );
                });

            } else {

                blocksByColumnGroup = _.object(_.map(groupedDataIndicesPairs, function(pair){
                    var listOfIndicesForGroup = pair[1];
                    return [
                        pair[0],
                        _.filter(_.map(allChildBlocks, function(blockData){
                            if (listOfIndicesForGroup.indexOf(blockData.index) > -1){
                                return blockData;
                            } else {
                                return null;
                            }
                        }), function(block){ return block !== null; })];
                }));

                columnKeys = _.keys(blocksByColumnGroup);
                if (Array.isArray(props.headerColumnsOrder)){
                    columnKeys = StackedBlockGroupedRow.sortByArray(columnKeys, props.headerColumnsOrder);
                }

                inner = columnKeys.map(function(k){
                    var blocksForGroup = blocksByColumnGroup[k];

                    //console.log('BFG-1', blocksForGroup);
                    
                    // If we have columnSubGrouping (we should, if we reached this comment, b/c otherwise we do the allChildBlocksPerGroup clause), we group these into smaller blocks/groups.
                    if (typeof props.columnSubGrouping === 'string' && props.depth <= (props.groupingProperties.length - 1)){
                        blocksForGroup = _.pairs(_.groupBy(blocksForGroup, props.columnSubGrouping));
                    }

                    //console.log('BFG-2', blocksForGroup);
                    return (
                        <div
                            className="block-container-group"
                            style={{
                                width : widthPerColumn,
                                minHeight : props.blockHeight + (props.blockVerticalSpacing),
                                paddingLeft : props.blockHorizontalSpacing,
                                paddingRight : props.blockHorizontalSpacing,
                                paddingTop : props.blockVerticalSpacing
                            }}
                            key={k}
                            data-group-key={k}
                        >
                            { blocksForGroup.map(function(blockData, i){
                                var title = k;
                                var parentGrouping = (props.titleMap && props.titleMap[props.groupingProperties[props.depth - 1]]) || null;
                                var subGrouping = (props.titleMap && props.titleMap[props.columnSubGrouping]) || null;
                                if (Array.isArray(blockData)) {
                                    // We have columnSubGrouping so these are -pairs- of (0) columnSubGrouping val, (1) blocks
                                    title = blockData[0];
                                    blockData = blockData[1];
                                } else if (typeof props.columnSubGrouping === 'string') {
                                    title = object.getNestedProperty(blockData, props.columnSubGrouping);
                                }
                                return <StackedBlock key={title || i} {...commonProps} data={blockData} title={title} parentGrouping={parentGrouping} subGrouping={subGrouping} />;
                            }) }
                        </div>
                    );
                });

            }
        } else {
            inner = allChildBlocks.map((pair)=> <StackedBlock {...commonProps} key={pair[0]} data={pair[1]} title={pair[0]} /> );
        }


        return <div className="blocks-container" style={{ 'minHeight' : props.blockHeight + props.blockVerticalSpacing }} children={inner}/>;
    }

    constructor(props){
        super(props);
        //console.log('BOOTUIP', props);
        this.toggleOpen = this.toggleOpen.bind(this);
        var initOpen = (Array.isArray(props.defaultDepthsOpen) && props.defaultDepthsOpen[props.depth]) || false;
        this.state = { 'open' : initOpen };
    }

    childBlocksCollapsed(widthAvailable = null){
        return StackedBlockGroupedRow.collapsedChildBlocks(this.props.data, this.props, widthAvailable);
    }

    toggleOpen(){
        this.setState({ open : !this.state.open });
    }

    render(){
        var { groupingProperties, depth, titleMap, group, blockHeight, blockVerticalSpacing, data, groupValue, groupedDataIndices, index, duplicateHeaders, showGroupingPropertyTitles } = this.props;
        var groupingPropertyTitle = null;
        if (Array.isArray(groupingProperties) && groupingProperties[depth]){
            groupingPropertyTitle = titleMap[groupingProperties[depth]] || groupingProperties[depth];
        }

        var isOpen = this.state.open;
        var className = "grouping depth-" + depth + (isOpen ? ' open' : '') + (duplicateHeaders && depth === 0 ? ' with-duplicated-headers' : '') + (' row-index-' + index) + (!showGroupingPropertyTitles ? ' no-grouping-property-titles' : '');
        var toggleIcon = null;
        if (!Array.isArray(data)) toggleIcon = <i className={"icon icon-fw icon-" + (isOpen ? 'minus' : 'plus')} />;
        if (toggleIcon){
            className += ' may-collapse';
        }
        
        var totalCount = null;
        if (depth === 0 && groupValue && typeof groupValue === 'function'){
            totalCount = groupValue(data, group, groupingPropertyTitle);
        }

        var widthAvailable = this.props.widthAvailable;
        if (!widthAvailable) {
            widthAvailable = (this.refs.listSection && this.refs.listSection.offsetWidth) || null;
            if (typeof widthAvailable === 'number' && !isNaN(widthAvailable) && widthAvailable) {
                widthAvailable -= 20;
            }
        }


        var header = null;
        if (depth === 0 && groupedDataIndices && ((isOpen && duplicateHeaders) || index === 0)){
            var minColumnWidth = StackedBlockVisual.minColumnWidth(this.props);
            var headerItemStyle = { 'width' : minColumnWidth };

            var columnKeys = _.keys(groupedDataIndices);
            if (Array.isArray(this.props.headerColumnsOrder)){
                columnKeys = StackedBlockGroupedRow.sortByArray(columnKeys, this.props.headerColumnsOrder);
            }
            header = (
                <div className="header-for-viz">
                    { columnKeys.map(function(k){
                        return (
                            <div key={k} className="column-group-header" style={headerItemStyle}>
                                <div className="inner">
                                    <span>{ k }</span>
                                </div>
                            </div>
                        );
                    }) }
                </div>
            );
        }

        var h4TitleProps = {
            'className' : "text-500 text-ellipsis-container",
            'data-tip' : group && typeof group === 'string' && group.length > 20 ? group : null
        };
        
        var childRowsKeys = isOpen && !Array.isArray(data) ? _.keys(data).sort() : null;

        return (
            <div className={className}>

                <div className="row">
                    <div className="col col-sm-4 label-section" style={{ minHeight : blockHeight + blockVerticalSpacing }}>
                        { groupingPropertyTitle && showGroupingPropertyTitles ? <small className="text-400 mb-0 mt-0">{ groupingPropertyTitle }</small> : null }
                        <h4 {...h4TitleProps}><span onClick={toggleIcon ? this.toggleOpen : null}>{ toggleIcon } { group }</span></h4>
                        {/* this.childLabels() */}
                    </div>
                    <div className={"col col-sm-8 list-section" + (header ? ' has-header' : '')} ref="listSection">
                        { header }
                        { !isOpen ? this.childBlocksCollapsed(widthAvailable) : null }
                    </div>
                </div>

                { isOpen && toggleIcon && depth > 0 ?
                    <div className="close-button" onClick={this.toggleOpen} children={toggleIcon}/>
                : null }

                <div className="child-blocks">
                    { childRowsKeys && _.map(childRowsKeys, (k)=>
                        <StackedBlockGroupedRow {...this.props} data={data[k]} key={k} group={k} depth={depth + 1} widthAvailable={widthAvailable} />
                    ) }
                </div>
                
            </div>
        );
    }

}


export class StackedBlock extends React.Component {

    componentDidMount(){
        ReactTooltip.rebuild();
    }

    render(){
        var { blockHeight, blockVerticalSpacing, blockHorizontalSpacing, data, title, groupingProperties, parentGrouping, depth, titleMap, blockClassName, blockRenderedContents, blockTooltipContents, blockPopover } = this.props;

        if (!title && data && !Array.isArray(data)){
            title = data[groupingProperties[depth]];
        }

        var groupingPropertyTitle;
        if (Array.isArray(data)){
            groupingPropertyTitle = titleMap[groupingProperties[depth + 1]] || groupingProperties[depth + 1];
        } else {
            groupingPropertyTitle = titleMap[groupingProperties[depth]] || groupingProperties[depth];
        }


        var style = {
            'height' : blockHeight,
            'width' : blockHeight,
            "lineHeight" : blockHeight + 'px',
            //'marginRight' : blockHorizontalSpacing,
            'marginBottom' : blockVerticalSpacing
        };

        var blockFxnArguments = [data, title, groupingPropertyTitle, this.props, parentGrouping];

        var className = "stacked-block";
        if (typeof blockClassName === 'function'){
            className += ' ' + blockClassName.apply(blockClassName, blockFxnArguments.slice(0));
        } else if (typeof blockClassName === 'string'){
            className += ' ' + blockClassName;
        }

        var contents = ( <span>&nbsp;</span> );
        if (typeof blockRenderedContents === 'function'){
            contents = blockRenderedContents.apply(blockRenderedContents, blockFxnArguments.slice(0));
        }

        var tip = null;
        if (typeof blockTooltipContents === 'function'){
            tip = blockTooltipContents.apply(blockTooltipContents, blockFxnArguments.slice(0));
        }

        var popover = null;
        if (typeof blockPopover === 'function'){
            popover = blockPopover.apply(blockPopover, blockFxnArguments.slice(0));
        }

        var blockElem = <div className={className} style={style} data-tip={tip} tabIndex={1} data-place="bottom" data-html onKeyUp={(e)=>{
            if (e.keyCode === 13 && this.refs && this.refs.trigger){
                console.log(this.refs.trigger, e.target);
                e.target.dispatchEvent(new MouseEvent('click'), { view : window, bubbles : true });
                this.refs.trigger.handleToggle();
            }
        }} >{ contents }</div>;

        if (popover){
            return (
                <OverlayTrigger trigger="click" placement="bottom" overlay={popover} children={blockElem} rootClose ref="trigger" />
            );
        }

        return blockElem;
    }

}


StackedBlockVisual.Row = StackedBlockGroupedRow;
