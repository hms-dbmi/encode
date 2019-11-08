'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import _ from 'underscore';
import memoize from 'memoize-one';

import { console, object } from '@hms-dbmi-bgm/shared-portal-components/es/components/util';
import { expFxn } from './../util';

import { ExperimentSetTablesLoaded } from './components/tables/ExperimentSetTables';
import { SimpleFilesTable, SimpleFilesTableLoaded } from './components/tables/SimpleFilesTable';
import { Publications } from './components/Publications';
import { OverviewHeadingContainer } from './components/OverviewHeadingContainer';

import { OverViewBodyItem, StaticHeadersArea } from './DefaultItemView';
import WorkflowRunTracingView, { FileViewGraphSection } from './WorkflowRunTracingView';


export default class ExperimentView extends WorkflowRunTracingView {

    static procesedFilesWithViewPermissions = memoize(function(context){
        return Array.isArray(context.processed_files) && _.filter(context.processed_files, function(rf){
            if (rf.error && !object.itemUtil.atId(rf)) return false;
            return true;
        });
    });

    constructor(props){
        super(props);
        this.shouldGraphExist = this.shouldGraphExist.bind(this);
        this.isNodeCurrentContext = this.isNodeCurrentContext.bind(this);

        /**
         * Explicit self-assignment to remind that we inherit the following properties from WorkfowRunTracingView:
         * `loadingGraphSteps`, `allRuns`, `steps`, & `mounted`
         */
        this.state = this.state;
    }

    shouldGraphExist(){
        const { context } = this.props;
        const procesedFilesWithViewPermissions = ExperimentView.procesedFilesWithViewPermissions(context);
        return !!(procesedFilesWithViewPermissions && procesedFilesWithViewPermissions.length > 0);
    }

    getFilesTabs(){
        const { context } = this.props;
        const width = this.getTabViewWidth();
        const tabs = [];

        const rawFilesWithViewPermissions = Array.isArray(context.files) && _.filter(context.files, function(rf){
            if (rf.error && !object.itemUtil.atId(rf)) return false;
            return true;
        });

        if (rawFilesWithViewPermissions && rawFilesWithViewPermissions.length > 0) {
            tabs.push({
                tab : <span><i className="icon icon-leaf fas icon-fw"/> Raw Files</span>,
                key : 'raw-files',
                content : <RawFilesTableSection
                    files={rawFilesWithViewPermissions}
                    width={width}
                    {..._.pick(this.props, 'context', 'schemas')}
                    {...this.state}
                />
            });
        }

        const procesedFilesWithViewPermissions = ExperimentView.procesedFilesWithViewPermissions(context);

        if (procesedFilesWithViewPermissions && procesedFilesWithViewPermissions.length > 0) {
            tabs.push({
                tab : <span><i className="icon icon-microchip fas icon-fw"/> Processed Files</span>,
                key : 'processed-files',
                content : <ProcessedFilesTableSection
                    files={procesedFilesWithViewPermissions}
                    width={width}
                    {..._.pick(this.props, 'context', 'schemas')}
                    {...this.state}
                />
            });
        }

        return tabs;
    }

    isNodeCurrentContext(node){
        const { context } = this.props;
        if (!context) return false;
        if (!node || !node.meta || !node.meta.run_data || !node.meta.run_data.file) return false;
        if (Array.isArray(node.meta.run_data.file)) return false;
        if (typeof node.meta.run_data.file.accession !== 'string') return false;
        if (!context.processed_files || !Array.isArray(context.processed_files) || context.processed_files === 0) return false;
        if (_.contains(_.pluck(context.processed_files, 'accession'), node.meta.run_data.file.accession)) return true;
        return false;
    }

    /**
     * This function is called by base class (DefaultItemView) render method to grab list of JS Objects which describe the Tabs and their content.
     * Properties which should be on the Objects within list are:
     *   'tab'      - React elements ascribing the 'title' of the tab (and any icons next to it.
     *   'key'      - Any unique string (among all tabs).
     *   'disabled' - Whether tab should appear grayed out and unclickable, e.g. for a graph which is still loading.
     *   'content'  - What is to be displayed in the body of the tab.
     *
     * @returns {{ tab : JSX.Element, key: string, disabled: boolean, content: JSX.Element }[]} List of JSON objects representing Tabs and their content.
     */
    getTabViewContents(){
        const { context } = this.props;
        const width = this.getTabViewWidth();
        const initTabs = [];

        if (parentExpSetsExistForExp(context)){ // 'Experiment Sets' tab, if any parent exp-sets.
            initTabs.push(ExperimentSetsViewOverview.getTabObject(this.props, width));
        }

        if (this.shouldGraphExist()){
            initTabs.push(FileViewGraphSection.getTabObject(
                _.extend({}, this.props, { 'isNodeCurrentContext' : this.isNodeCurrentContext }),
                this.state,
                this.handleToggleAllRuns,
                width
            ));
        }

        return initTabs.concat(this.getFilesTabs()).concat(this.getCommonTabs());
    }

    /**
     * What is to be displayed at top left of page, under title, to the left of accession (if any).
     *
     * @returns {{ title: string|JSX.Element, description: string }} JS Object ascribing what to display.
     */
    typeInfo(){
        const experimentType = expFxn.getExperimentTypeStr(this.props.context);
        if (experimentType){
            return {
                'title' : experimentType,
                'description' : "Type of Experiment"
            };
        }
        return null;
    }

    /**
     * What is to be displayed below Item description and above the TabbedView, if anything. Can return an array or single item.
     *
     * @returns {JSX.Element[]} React elements or components to display between Item header and Item TabbedView.
     */
    itemMidSection(){
        const { context } = this.props;
        return (
            <React.Fragment>
                <Publications.PublicationBelowHeaderRow publication={context.produced_in_pub} />
                <StaticHeadersArea context={context} />
                <OverviewHeading context={context} />
            </React.Fragment>
        );
    }

}



export class ExperimentMicView extends ExperimentView {
    /** Uses OverviewHeadingMic instead of OverviewHeading as in ExperimentView. */
    itemMidSection(){
        return (
            <React.Fragment>
                <Publications.PublicationBelowHeaderRow publication={this.props.context.produced_in_pub} />
                <StaticHeadersArea context={this.props.context} key="static-headers-area" />
                <OverviewHeadingMic context={this.props.context} />
            </React.Fragment>
        );
    }
}


/**
 * This is the first Tab of the Experiment Item view and shows what ExperimentSets the Experiment is part of.
 *
 * @see ExperimentView.getTabViewContents()
 * @todo Change to have ExpSets loaded from single search URL instead of spinning off multiple AJAX requests.
 */
const ExperimentSetsViewOverview = React.memo(function ExperimentSetsViewOverview(props){
    const { context, width, windowWidth, href } = props;
    const experimentSetUrls = _.filter(_.map(context.experiment_sets || [], object.atIdFromObject));

    if (experimentSetUrls.length > 0){
        return <ExperimentSetTablesLoaded {...{ experimentSetUrls, width, windowWidth, href }} defaultOpenIndices={[0]} id={object.itemUtil.atId(context)} />;
    }

    return null;
});
ExperimentSetsViewOverview.propTypes = {
    'context' : PropTypes.shape({
        'experiment_sets' : PropTypes.arrayOf(PropTypes.shape({
            '@id' : PropTypes.string.isRequired
        })).isRequired
    }).isRequired,
    'width' : PropTypes.number.isRequired,
    'windowWidth' : PropTypes.number,
    'href' : PropTypes.string
};
ExperimentSetsViewOverview.getTabObject = function({ schemas, context, windowWidth }, width){
    return {
        'tab' : <span><i className="icon icon-file-alt fas icon-fw"/> Experiment Sets</span>,
        'key' : 'experiments-info',
        //'disabled' : !Array.isArray(context.experiments),
        'content' : (
            <div className="overflow-hidden">
                <ExperimentSetsViewOverview {...{ context, schemas, windowWidth, width }} />
            </div>
        )
    };
};

const parentExpSetsExistForExp = memoize(function(exp){
    return (exp && Array.isArray(exp.experiment_sets) && exp.experiment_sets.length > 0 && object.atIdFromObject(exp.experiment_sets[0]));
});


/**
 * This is rendered in middle of ExperimentView, between Item header and TabbedView.
 * @see ExperimentView.itemMidSection()
 */
const OverviewHeading = React.memo(function OverviewHeading(props){
    const { context, schemas } = props;
    const { biosample } = context;
    const tips = object.tipsFromSchema(schemas, context); // In form of { 'description' : {'title', 'description', 'type'}, 'experiment_type' : {'title', 'description', ...}, ... }
    const tipsForBiosample = object.tipsFromSchema(schemas, _.extend({ '@type' : ['Biosample', 'Item'] }, biosample));
    const commonProps = {
        'tips'          : tips,                 // Object containing 'properties' from Schema for Experiment ItemType. Informs the property title (from schema) & tooltip you get when hover over property title. Obtained from schemas.
        'result'        : context,              // The Item from which are getting value for 'property'.
        'wrapInColumn'  : "col-6 col-md-3"   // Optional. Size of the block. @see http://getbootstrap.com/docs/3.3/examples/grid/.
    };
    const commonBioProps = _.extend({ 'tips' : tipsForBiosample, 'result' : biosample }, { 'wrapInColumn' : commonProps.wrapInColumn });

    return (
        <OverviewHeadingContainer>
            <OverViewBodyItem {...commonProps} property="experiment_type" fallbackTitle="Experiment Type" />
            <OverViewBodyItem {...commonProps} property="follows_sop" fallbackTitle="Follows SOP" fallbackValue="No" />
            <OverViewBodyItem {...commonProps} property="biosample" fallbackTitle="Biosample" />
            <OverViewBodyItem {...commonProps} property="digestion_enzyme" fallbackTitle="Digestion Enzyme" />
            <OverViewBodyItem {...commonBioProps} property="modifications_summary" fallbackTitle="Biosample Modifications" />
            <OverViewBodyItem {...commonBioProps} property="treatments_summary" fallbackTitle="Biosample Treatments" />
            <OverViewBodyItem {...commonBioProps} property="biosource" fallbackTitle="Biosample Biosource" />
        </OverviewHeadingContainer>
    );
});

/**
 * This is rendered in middle of ExperimentView, between Item header and TabbedView.
 * @see ExperimentView.itemMidSection()
 */
const OverviewHeadingMic = React.memo(function OverviewHeadingMic(props){
    const { context: exp, schemas } = props;
    const tips = object.tipsFromSchema(schemas, exp); // In form of { 'description' : {'title', 'description', 'type'}, 'experiment_type' : {'title', 'description', ...}, ... }
    const tipsForBiosample = object.tipsFromSchema(schemas, _.extend({ '@type' : ['Biosample', 'Item'] }, exp.biosample));
    const commonProps = {
        'tips'          : tips,                 // Object containing 'properties' from Schema for Experiment ItemType. Informs the property title (from schema) & tooltip you get when hover over property title. Obtained from schemas.
        'result'        : exp,                  // The Item from which are getting value for 'property'.
        'wrapInColumn'  : "col-6 col-md-3"   // Optional. Size of the block. @see http://getbootstrap.com/docs/3.3/examples/grid/.
    };
    const commonBioProps = _.extend({ 'tips' : tipsForBiosample, 'result' : exp.biosample }, { 'wrapInColumn' : commonProps.wrapInColumn });

    return (
        <OverviewHeadingContainer>
            <OverViewBodyItem {...commonProps} property="experiment_type" fallbackTitle="Experiment Type" />
            <OverViewBodyItem {...commonProps} property="follows_sop" fallbackTitle="Follows SOP" fallbackValue="No" />
            <OverViewBodyItem {...commonProps} property="biosample" fallbackTitle="Biosample" />
            <OverViewBodyItem {...commonBioProps} property="biosource" fallbackTitle="Biosample Biosource" />
            <OverViewBodyItem {...commonBioProps} property="modifications_summary" fallbackTitle="Biosample Modifications" />
            <OverViewBodyItem {...commonBioProps} property="treatments_summary" fallbackTitle="Biosample Treatments" />
            <OverViewBodyItem {...commonProps} property="microscopy_technique" fallbackTitle="Microscopy Technique" />
            <OverViewBodyItem {...commonProps} property="microscope_qc" fallbackTitle="Microscope Quality Control" />

            <OverViewBodyItem {...commonProps} property="sample_image" fallbackTitle="Sample Image"
                wrapInColumn="col-12 col-md-3" singleItemClassName="block"
                titleRenderFxn={OverViewBodyItem.titleRenderPresets.embedded_item_with_image_attachment} hideIfNoValue />

            <OverViewBodyItem {...commonProps} property="imaging_paths" fallbackTitle="Imaging Paths"
                wrapInColumn="col-12 col-md-9 pull-right" listItemElement="div" listWrapperElement="div" singleItemClassName="block"
                titleRenderFxn={OverViewBodyItem.titleRenderPresets.imaging_paths_from_exp} />

        </OverviewHeadingContainer>
    );
});


const RawFilesTableSection = React.memo(function RawFilesTableSection(props){
    const { files, context } = props;
    const fileUrls    = _.map(files, object.itemUtil.atId);
    const columns     = _.clone(SimpleFilesTable.defaultProps.columns);

    columns['related_files'] = {
        'title' : 'Relations',
        'minColumnWidth' : 120,
        'render' : function(result, columnDefinition, props, width){
            var related_files = _.map(_.filter(result.related_files, function(rF){ return rF.file && object.atIdFromObject(rF.file); }), function(fContainer, i){
                var link = object.atIdFromObject(fContainer.file);
                var title = typeof fContainer.file.accession === 'string' ? <span className="mono-text">{fContainer.file.accession}</span> : fContainer.file.display_title;
                return <span key={link || i}>{ fContainer.relationship_type } { link ? <a href={link}>{ title }</a> : title }</span>;
            });
            return related_files;
        }
    };

    // Add column for paired end if any files have one.
    if (_.any(files, function(f) { return typeof f.paired_end !== 'undefined'; })){
        columns['paired_end'] = {
            "title" : 'End',
            'widthMap' : { 'sm' : 30, 'md' : 40, 'lg' : 50 },
            'minColumnWidth' : 30
        };
    }

    return (
        <div className="raw-files-table-section">
            <h3 className="tab-section-title">
                <span><span className="text-400">{ files.length }</span> Raw File{ files.length === 1 ? '' : 's' }</span>
            </h3>
            <SimpleFilesTableLoaded {..._.pick(props, 'schemas', 'width')} columns={columns} fileUrls={fileUrls} id={object.itemUtil.atId(context)} />
        </div>
    );
});

const ProcessedFilesTableSection = React.memo(function ProcessedFilesTableSection(props){
    const { files, context } = props;
    const fileUrls = _.map(files, object.itemUtil.atId);
    return (
        <div className="processed-files-table-section">
            <h3 className="tab-section-title">
                <span><span className="text-400">{ files.length }</span> Processed File{ files.length === 1 ? '' : 's' }</span>
            </h3>
            <SimpleFilesTableLoaded {..._.pick(props, 'schemas', 'width')} fileUrls={fileUrls} id={object.itemUtil.atId(context)} />
        </div>
    );
});
