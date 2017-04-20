'use strict';

var React = require('react');
var url = require('url');
var globals = require('./../globals');
var { console, object, Filters } = require('./../util');
import { ItemPageTitle, ItemDetailList } from './components';

/**
 * Fallback content_view for pages which are not specifically 'Items.
 * Renders out JSON.
 * 
 * @export
 * @class Item
 * @extends {React.Component}
 */
export class Fallback extends React.Component {

    constructor(props){
        super(props);
        this.render = this.render.bind(this);
    }

    render() {
        var context = this.props.context;
        var title = typeof context.title == "string" ? context.title : url.parse(this.context.location_href).path;
        return (
            <div className="view-item">
                <ItemPageTitle context={context} showType={false} />
                {typeof context.description == "string" ? <p className="description">{context.description}</p> : null}
                <ItemDetailList context={context} schemas={this.props.schemas} />
            </div>
        );
    }
};

Fallback.contextTypes = {
    location_href: React.PropTypes.string
}

// Use this view as a fallback for anything we haven't registered
globals.content_views.fallback = function () {
    return Fallback;
};