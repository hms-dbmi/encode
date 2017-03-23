'use strict';

var React = require('react');
var _ = require('underscore');
var vizUtil = require('./../utilities');
var { RotatedLabel, Legend } = require('./../components');
var { console, object, isServerSide, expFxn, Filters, layout } = require('./../../util');
var { ButtonToolbar, ButtonGroup, Button, DropdownButton, MenuItem } = require('react-bootstrap');

var UIControlsWrapper = module.exports = React.createClass({

    /**
     * Default props for the UIControlsWrapper.
     * @memberof module:viz/BarPlot.UIControlsWrapper
     * @instance
     */
    getDefaultProps : function(){
        return {
            'titleMap' : {
                // Aggr type
                'experiment_sets' : "Experiment Sets",
                'experiments' : 'Experiments',
                'files' : "Files",
                // Show state
                'all' : 'All',
                'filtered' : 'Selected',
                'both' : 'All & Selected'
            },
            'availableFields1' : [
                { title : "Biosource", field : "experiments_in_set.biosample.biosource_summary" },
                { title : "Digestion Enzyme", field : "experiments_in_set.digestion_enzyme.name" },
                { title : "Biosource Type", field : 'experiments_in_set.biosample.biosource.biosource_type' }
            ],
            'availableFields2' : [
                { title : "Experiment Type", field : 'experiments_in_set.experiment_type' },
                { title : "Organism", field : "experiments_in_set.biosample.biosource.individual.organism.name" },
            ],
            'legend' : false,
            'chartHeight' : 300
        };
    },

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    getInitialState : function(){
        return {
            'fields' : [
                this.props.availableFields1[0],
                this.props.availableFields2[0],
                //{ title : "Experiment Summary", field : "experiments_in_set.experiment_summary" }
            ],
            'aggregateType' : 'experiment_sets',
            'showState' : 'all'
        };
    },

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    componentWillReceiveProps : function(nextProps){
        if (this.filterObjExistsAndNoFiltersSelected(nextProps.expSetFilters)){
            this.setState({ 'showState' : 'all' });
        }
    },

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    filterObjExistsAndNoFiltersSelected : function(expSetFilters = this.props.expSetFilters){
        return (
            typeof expSetFilters === 'object'
            && expSetFilters !== null
            && _.keys(expSetFilters).length === 0
        );
    },

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    titleMap : function(key = null, fromDropdown = false){
        if (!key) return this.props.titleMap;
        var title = this.props.titleMap[key];
        if (fromDropdown && ['all','filtered'].indexOf(key) > -1){
            title += ' ' + this.titleMap(this.state.aggregateType);
        } else if (fromDropdown && key == 'both'){
            return 'Both';
        }
        return title;
    },

    /**
     * Clones props.children, expecting a Chart React Component as the sole child, and extends Chart props with 'fields', 'showType', and 'aggregateType'.
     * @instance
     * @returns {React.Component} Cloned & extended props.children.
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    adjustedChildChart : function(){
        // TODO: validate that props.children is a BarPlot.Chart

        return React.cloneElement(
            this.props.children,
            _.extend(
                _.omit( // Own props minus these.
                    this.props,
                    'titleMap', 'availableFields1', 'availableFields2', 'legend', 'chartHeight', 'children'
                ),
                {
                    'fields' : this.state.fields,
                    'showType' : this.state.showState,
                    'aggregateType' : this.state.aggregateType,
                }
            )
        );
    },

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    handleAggregateTypeSelect : _.throttle(function(eventKey, event){
        this.setState({ aggregateType : eventKey });
    }, 300),

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    handleExperimentsShowType : _.throttle(function(eventKey, event){
        this.setState({ showState : eventKey });
    }, 300),

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    handleFieldSelect : _.throttle(function(fieldIndex, newFieldKey, event){
        var newFields;
        if (newFieldKey === "none"){ // Only applies to subdivision (fieldIndex 1)
            newFields = this.state.fields.slice(0,1);
            this.setState({ fields : newFields });
            return;
        }

        var newField = _.find(
            this.props['availableFields' + (fieldIndex + 1)],
            { field : newFieldKey }
        );
        var otherFieldIndex = fieldIndex === 0 ? 1 : 0;
        if (fieldIndex === 0 && this.state.fields.length === 1){
            newFields = [null];
        } else {
            newFields = [null, null];
        }
        newFields[fieldIndex] = newField;
        if (newFields.length > 1) newFields[otherFieldIndex] = this.state.fields[otherFieldIndex];
        this.setState({ fields : newFields });
        //this.setState({ showState : eventKey });
    }, 300),

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    getFieldAtIndex : function(fieldIndex){
        if (!this.state.fields) return null;
        if (!Array.isArray(this.state.fields)) return null;
        if (this.state.fields.length < fieldIndex + 1) return null;
        return this.state.fields[fieldIndex];
    },

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    renderDropDownMenuItems : function(keys, active = null, noFiltersSet = true, disabledTitle = null){
        return keys.map((key)=>{
            var subtitle = null;
            var title = null;
            if (Array.isArray(key)){
                // Assume we have [key, title, subtitle].
                title = key[1] || null;
                subtitle = key[2] || null;
                key = key[0];
            }
            var disabled = noFiltersSet && (key === 'filtered' || key === 'both');
            return <MenuItem
                key={key}
                eventKey={key}
                active={key === active}
                children={title || this.titleMap(key, true)}
                disabled={disabled}
                title={(disabled && disabledTitle) || subtitle || null}
            />;
        });
    },

    /**
     * @ignore
     * @memberof module:viz/BarPlot.UIControlsWrapper
     */
    render : function(){

        if (!this.props.experiments) return null;
        
        var filterObjExistsAndNoFiltersSelected = this.filterObjExistsAndNoFiltersSelected();
        var windowGridSize = layout.responsiveGridState();

        return (
            <div className="bar-plot-chart-controls-wrapper">
                <div className="overlay" style={{
                    width  : (windowGridSize !== 'xs' ? (layout.gridContainerWidth() * (9/12) - 15) : null)
                }}>

                    <div className="y-axis-top-label" style={{
                        width : this.props.chartHeight,
                        top: this.props.chartHeight - 40
                    }}>
                        <DropdownButton
                            id="select-barplot-aggregate-type"
                            bsSize="xsmall"
                            onSelect={this.handleAggregateTypeSelect}
                            title={this.titleMap(this.state.aggregateType)}
                            children={this.renderDropDownMenuItems(
                                ['experiment_sets','experiments','files'],
                                this.state.aggregateType
                            )}
                        />
                    </div>

                    <div className={"toggle-zoom" + (filterObjExistsAndNoFiltersSelected ? ' no-click' : '')} onClick={()=>
                        this.handleExperimentsShowType(this.state.showState === 'all' ? 'filtered' : 'all')
                    }>
                        <div className="text">
                            <small>Viewing</small><br/>
                            {this.state.showState === 'all' ? 'All' : 'Selected'}
                        </div>
                        <i className={"icon icon-search-" + (this.state.showState === 'all' ? 'plus' : 'minus')}/>
                    </div>
                    
                    <div className="controls" style={{ display : 'none'}}>
                        <ButtonToolbar>
                            <ButtonGroup>
                                <DropdownButton
                                    id="select-barplot-experiments-type"
                                    onSelect={this.handleExperimentsShowType}
                                    title={
                                        <div className="dropdown-title-container">
                                            <small>Show</small><br/>
                                            <h5>{ this.titleMap(!filterObjExistsAndNoFiltersSelected ? this.state.showState : 'all') }</h5>
                                        </div>
                                    }
                                    children={this.renderDropDownMenuItems(
                                        ['filtered','all'],
                                        this.state.showState,
                                        filterObjExistsAndNoFiltersSelected,
                                        "Please select some filters first."
                                    )}
                                />
                                
                            </ButtonGroup>
                        </ButtonToolbar>
                    </div>

                </div>

                <div className="row">
                    <div className="col-sm-9">
                        { this.adjustedChildChart() }
                    </div>
                    <div className="col-sm-3 chart-aside" style={{ height : this.props.chartHeight }}>
                        <div className="legend-container" style={{ height : windowGridSize !== 'xs' ? 
                            this.props.chartHeight - 49 : null
                        }}>
                            <DropdownButton
                                id="select-barplot-field-1"
                                onSelect={this.handleFieldSelect.bind(this, 1)}
                                title={(()=>{
                                    var field = this.getFieldAtIndex(1);
                                    if (!field) return "None";
                                    return field.title || Filters.Field.toName(field.field);
                                })()}
                                children={this.renderDropDownMenuItems(
                                    this.props.availableFields2.concat([{
                                        title : <em>None</em>,
                                        field : "none"
                                    }]).map(function(field){
                                        return [
                                            field.field,
                                            field.title || Filters.Field.toName(field.field),
                                            field.description || null
                                        ]; // key, title, subtitle
                                    }),
                                    (this.state.fields[1] && this.state.fields[1].field) || "none"
                                )}
                            />
                            <Legend
                                fields={(
                                    this.props.experiments && this.state.fields[1] ? (
                                        Legend.experimentsAndFieldsToLegendData(
                                            this.state.showState === 'filtered' ? 
                                                (this.props.filteredExperiments || this.props.experiments)
                                                : this.props.experiments,
                                            [this.state.fields[1]],
                                            this.props.schemas
                                        )
                                    ) : null
                                )}
                                includeFieldTitles={false}
                                schemas={this.props.schemas}
                                width={layout.gridContainerWidth() * (3/12) - 20}
                            />
                        </div>
                        <div className="x-axis-right-label">
                            <DropdownButton
                                id="select-barplot-field-0"
                                onSelect={this.handleFieldSelect.bind(this, 0)}
                                title={(()=>{
                                    var field = this.getFieldAtIndex(0);
                                    return field.title || Filters.Field.toName(field.field);
                                })()}
                                children={this.renderDropDownMenuItems(
                                    this.props.availableFields1.map(function(field){
                                        return [
                                            field.field,
                                            field.title || Filters.Field.toName(field.field),
                                            field.description || null
                                        ]; // key, title, subtitle
                                    }),
                                    this.state.fields[0].field
                                )}
                            />
                        </div>

                    </div>
                </div>
            </div>
        );
    }

});