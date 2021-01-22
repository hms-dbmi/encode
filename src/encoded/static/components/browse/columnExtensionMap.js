'use strict';

import React from 'react';
import _ from 'underscore';

import { console, object } from '@hms-dbmi-bgm/shared-portal-components/es/components/util';
import { LocalizedTime, formatPublicationDate } from '@hms-dbmi-bgm/shared-portal-components/es/components/ui/LocalizedTime';
import { basicColumnExtensionMap } from '@hms-dbmi-bgm/shared-portal-components/es/components/browse/components/table-commons';
import { Schemas, typedefs, expFxn } from './../util';

// eslint-disable-next-line no-unused-vars
const { Item, ColumnDefinition } = typedefs;

export const DEFAULT_WIDTH_MAP = { 'lg' : 200, 'md' : 180, 'sm' : 120, 'xs' : 120 };

/** Is reused in a couple of places */
function labDisplayTitleRenderFxn(result, props){
    const { lab, submitted_by : { display_title : submitterTitle } = {} } = result;
    if (!lab) return null;
    const labLink = <a href={object.atIdFromObject(lab)}>{ lab.display_title }</a>;
    if (!submitterTitle){
        return <span className="value">{ labLink }</span>;
    }
    return (
        <span className="text-truncate">
            <i className="icon icon-fw icon-user far user-icon" data-html data-tip={'<small>Submitted by</small> ' + result.submitted_by.display_title} />
            { labLink }
        </span>
    );
}
function sourceDisplayTitleRenderFxn(result) {
    const { source_experiment_sets } = result;
    if (!source_experiment_sets || !Array.isArray(source_experiment_sets) || source_experiment_sets.length === 0) return null;
    if (source_experiment_sets.length == 1) {
        const [exp_set] = source_experiment_sets;
        return (
            <span>
                <a href={object.atIdFromObject(exp_set)}>{exp_set.display_title}</a>
            </span>
        );
    } else {
        const expSetLinks = source_experiment_sets.map((exp_set) => {
            const atId = object.atIdFromObject(exp_set);
            return (
                <li key={atId}>
                    <a href={atId}>{exp_set.display_title}</a>
                </li>
            );
        });
        return (<ol style={{ marginTop: '15px', paddingLeft: '14px' }}>{expSetLinks}</ol>);
    }
}
export const columnExtensionMap = _.extend({}, basicColumnExtensionMap, {
    // TODO: change to organization
    'lab.display_title' : {
        'title' : "Lab",
        'widthMap' : { 'lg' : 200, 'md' : 180, 'sm' : 160 },
        'render' : labDisplayTitleRenderFxn
    },
    'source_experiment_sets.@id' : {
        'title' : "Source",
        'widthMap' : { 'lg' : 140, 'md' : 120, 'sm' : 120 },
        'render' : sourceDisplayTitleRenderFxn
    },
    'date_published' : {
        'widthMap' : { 'lg' : 140, 'md' : 120, 'sm' : 120 },
        'render' : function(result, props){
            const { date_published = null } = result;
            if (!date_published) return null;
            return (
                <span className="value text-right">
                    { formatPublicationDate(date_published) }
                </span>
            );
        },
        'order' : 504
    },
    'google_analytics.for_date' : {
        'title' : 'Analytics Date',
        'widthMap' : { 'lg' : 140, 'md' : 120, 'sm' : 120 },
        'render' : function googleAnalyticsDate(result, props){
            if (!result.google_analytics || !result.google_analytics.for_date) return null;
            return (
                <span className="value text-right">
                    <LocalizedTime timestamp={result.google_analytics.for_date} formatType="date-sm" localize={false} />
                </span>
            );
        }
    },
    'status' : {
        'title' : 'Status',
        'widthMap' : { 'lg' : 120, 'md' : 120, 'sm' : 100 },
        'order' : 501,
        'render' : function statusIndicator(result, props){
            const statusFormatted = Schemas.Term.toName('status', result.status);
            return (
                <span className="value">
                    <i className="item-status-indicator-dot mr-07" data-status={result.status}/>
                    { statusFormatted }
                </span>
            );
        }
    },
    'url' : {
        'title' : "URL", // would get overriden by schema facet title, if any.
        'widthMap' : { 'lg' : 140, 'md' : 120, 'sm' : 120 }, // Use this to control initial column width at dif window-size breakpoints, e.g. if want more narrow col.
        'render' : function(result, propsFromTable){
            const { url: urlValue } = result;
            let valToShow = urlValue;
            if (typeof urlValue === "string" && urlValue.match(/^(https?:\/\/)/)){
                valToShow = valToShow = (
                    <a href={urlValue} target="_blank" rel="noopener noreferrer">
                        <i className="icon icon-external-link-alt fas" />
                    </a>
                );
            }
            return <span className="value text-center">{ valToShow }</span>;
        }
    },
    'attachment' : {
        'widthMap' : { 'lg' : 120, 'md' : 120, 'sm' : 120 },
        'render': function(result, props){
            const { attachment = null } = result;
            if (!attachment) return null;
            const { href: attachHref = '' } = attachment;
            return (
                <a href={object.itemUtil.atId(result) + attachHref} className="btn btn-xs btn-primary" data-tip="Download attached file" disabled={attachHref.length === 0}>
                    <i className="icon icon-fw icon-file-pdf far" />
                </a>
            );
        }
    },
    'workflow.title' : {
        'title' : "Workflow",
        'render' : function(result, props){
            if (!result.workflow || !result.workflow.title) return null;
            const { title }  = result.workflow;
            const link = object.itemUtil.atId(result.workflow);
            if (link){
                return (
                    <span className="value">
                        <a href={link}>{ title }</a>
                    </span>
                );
            } else {
                return <span className="value">{ title }</span>;
            }
        }
    },
    'track_and_facet_info.lab_name' : {
        'render' : function(result, props){
            const {
                track_and_facet_info: { lab_name } = {},
                lab : { display_title: labTitle } = {}
            } = result;
            if (!lab_name) return null;
            if (lab_name && labTitle && lab_name === labTitle){
                // If same exact lab name as our lab.display_title, then we just use lab render method to get link to lab.
                return labDisplayTitleRenderFxn(...arguments);
            } else {
                return (
                    <span className="value">{ lab_name }</span>
                );
            }
        }
    },
    'public_release' : {
        'widthMap' : { 'lg' : 140, 'md' : 120, 'sm' : 120 },
        'render' : function publicRelease(result, props){
            if (!result.public_release) return null;
            return (
                <span className="value text-right">
                    <LocalizedTime timestamp={result.public_release} formatType="date-sm" />
                </span>
            );
        },
        'order' : 505
    },
    'number_of_experiments' : {
        'title' : '# of Experiments',
        'widthMap' : { 'lg' : 68, 'md' : 68, 'sm' : 50 },
        'render' : function numberOfExperiments(expSet, props){
            let number_of_experiments = parseInt(expSet.number_of_experiments); // Should exist in DB. Fallback below.
            if (isNaN(number_of_experiments) || !number_of_experiments){
                number_of_experiments = (Array.isArray(expSet.experiments_in_set) && expSet.experiments_in_set.length) || null;
            }
            if (!number_of_experiments){
                number_of_experiments = 0;
            }
            return <span className="value text-center">{ number_of_experiments }</span>;
        }
    },
    'number_of_files' : {
        'title' : '# of Files',
        'noSort' : true,
        'widthMap' : { 'lg' : 60, 'md' : 50, 'sm' : 50 },
        'render' : function numberOfFiles(expSet, props){
            let number_of_files = parseInt(expSet.number_of_files); // Doesn't exist yet at time of writing
            if (isNaN(number_of_files) || !number_of_files){
                number_of_files = expFxn.fileCountFromExperimentSet(expSet, true, false);
            }
            if (!number_of_files){
                number_of_files = 0;
            }
            return <span className="value text-center">{ number_of_files }</span>;
        }

    },
    'experiments_in_set.experiment_categorizer.combined' : {
        'title' : "Assay Details",
        'render' : function experimentCategorizer(result, props){
            // We have arrays here because experiments_in_set is array.
            const cat_value = _.uniq(object.getNestedProperty(result, 'experiments_in_set.experiment_categorizer.value', true)).join('; ');
            // Use first value for name (should be same for all)
            const [ cat_field ] = _.uniq(object.getNestedProperty(result, 'experiments_in_set.experiment_categorizer.field', true));
            if (cat_value === 'No value' || !cat_value){
                return null;
            }
            return (
                <div className="exp-categorizer-cell">
                    <small>{ cat_field }</small>
                    <div className="text-truncate">{ cat_value }</div>
                </div>
            );
        }
    },
    'experiments_in_set.biosample.biosource.individual.organism.name' : {
        'widthMap' : { 'lg' : 160, 'md' : 140, 'sm' : 120 }
    },
    'experiments_in_set.biosample.biosource_summary' : {
        'widthMap' : { 'lg' : 260, 'md' : 230, 'sm' : 180 }
    },
    'date_created' : {
        'title' : 'Date Created',
        'widthMap' : { 'lg' : 140, 'md' : 120, 'sm' : 120 },
        'render' : function dateCreatedTitle(result, props){
            if (!result.date_created) return null;
            return (
                <span className="value text-center">
                    <LocalizedTime timestamp={result.date_created} formatType="date-sm" />
                </span>
            );
        },
        'order' : 510
    },
    'last_modified.date_modified' : {
        'title' : 'Date Modified',
        'widthMap' : { 'lg' : 140, 'md' : 120, 'sm' : 120 },
        'render' : function lastModifiedDate(result, props){
            const { last_modified : { date_modified = null } = {} } = result;
            if (!date_modified) return null;
            return (
                <span className="value text-center">
                    <LocalizedTime timestamp={date_modified} formatType="date-sm" />
                </span>
            );
        },
        'order' : 515
    }
});
