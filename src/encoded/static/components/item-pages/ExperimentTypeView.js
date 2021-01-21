'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import _ from 'underscore';

import { console, object } from '@hms-dbmi-bgm/shared-portal-components/es/components/util';
import DefaultItemView, { OverViewBodyItem, StaticHeadersArea } from './DefaultItemView';
import { Publications } from './components/Publications';
import { SOPBelowHeaderRow, LinkBelowHeaderRow } from './components/LinkBelowHeaderRow';
import { WrappedCollapsibleList } from './components/FormattedInfoBlock';
import { ExperimentSetsTableTabView } from './components/tables/ExperimentSetTables';
import { UserContentBodyList } from './../static-pages/components';
import { getTabStaticContent } from './components/TabbedView';


export default class ExperimentTypeView extends DefaultItemView {

    getTabViewContents(){
        const { context, browseBaseState } = this.props;
        const tabs = [];
        const width = this.getTabViewWidth();
        const expSetTableTabViewProps = {
            'searchHref' : (
                "/browse/?type=ExperimentSetReplicate&experimentset_type=replicate&" +
                "experiments_in_set.experiment_type.display_title=" + encodeURIComponent(context.display_title)
            ),
            'facets' : null,
            // Gets passed down to `ExperimentSetsTableTabView` which passes it down to `SearchTableTitle`
            'externalSearchLinkVisible' : true
        };

        tabs.push(ExperimentTypeViewOverview.getTabObject(this.props));

        tabs.push(ExperimentSetsTableTabView.getTabObject(expSetTableTabViewProps, width));

        return tabs.concat(this.getCommonTabs());
    }

    /**
     * What is to be displayed below Item description and above the TabbedView, if anything. Can return an array or single item.
     *
     * @returns {JSX.Element[]} React elements or components to display between Item header and Item TabbedView.
     */
    itemMidSection(){
        const { context : { reference_pubs = [], sop, reference_protocol = {} } } = this.props;

        const pubsLen = reference_pubs.length || 0;

        let publicationArea;
        if (pubsLen === 1){
            publicationArea = (
                <Publications.PublicationBelowHeaderRow singularTitle="Reference Publication"
                    publication={reference_pubs[0]} outerClassName={null} />
            );
        } else if (pubsLen > 1){
            publicationArea = (
                <WrappedCollapsibleList items={reference_pubs} singularTitle="Reference Publication" itemClassName="publication" />
            );
        }

        const { link : refProtocolUrl, title: refProtocolTitle } = reference_protocol;
        return (
            <div className="mb-2">
                { publicationArea }
                <SOPBelowHeaderRow sop={sop} />
                <LinkBelowHeaderRow url={refProtocolUrl} title={refProtocolTitle} />
                <StaticHeadersArea context={this.props.context} key="static-headers-area" />
            </div>
        );
    }

}


const ExperimentTypeViewOverview = React.memo(function ExperimentTypeViewOverview({ context, schemas }){
    const staticContent = getTabStaticContent(context, 'tab:overview');

    return (
        <div>
            <OverViewBody result={context} schemas={schemas} />
            { staticContent.length > 0 ? (
                <div className="mt-2">
                    <hr/>
                    <UserContentBodyList contents={staticContent} />
                </div>
            ) : null }
        </div>
    );
});
ExperimentTypeViewOverview.getTabObject = function({ context, schemas }){
    return {
        'tab' : <span><i className="icon icon-file-alt fas icon-fw"/> Overview</span>,
        'key' : 'overview',
        //'disabled' : !Array.isArray(context.experiments),
        'content' : (
            <div className="overflow-hidden">
                <h3 className="tab-section-title">
                    <span>Overview</span>
                </h3>
                <hr className="tab-section-title-horiz-divider"/>
                <ExperimentTypeViewOverview context={context} schemas={schemas} />
            </div>
        )
    };
};


const OverViewBody = React.memo(function OverViewBody(props){

    const { result, schemas } = props;
    const tips = object.tipsFromSchema(schemas, result);
    const commonProps = { result, tips, 'wrapInColumn' : 'col-6 col-md-3' };

    return (
        <div className="row">
            <div className="col-md-12 col-12">
                <div className="row overview-blocks">

                    <OverViewBodyItem {...commonProps} property="experiment_category" fallbackTitle="Experiment Category" />
                    <OverViewBodyItem {...commonProps} property="assay_classification" fallbackTitle="Assay Classification" />
                    <OverViewBodyItem {...commonProps} property="assay_subclassification" fallbackTitle="Experimental Purpose" />
                    <OverViewBodyItem {...commonProps} property="raw_file_types" fallbackTitle="Raw Files Available" />

                </div>
            </div>
        </div>
    );
});
