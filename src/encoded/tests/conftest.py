'''py.test fixtures for Pyramid.

http://pyramid.readthedocs.org/en/latest/narr/testing.html
'''
from pytest import fixture

engine_settings = {
    'sqlalchemy.url': 'sqlite://',
}

app_settings = {
    'multiauth.policies': 'authtkt remoteuser',
    'multiauth.groupfinder': 'encoded.authorization.groupfinder',
    'multiauth.policy.authtkt.use': 'pyramid.authentication.AuthTktAuthenticationPolicy',
    'multiauth.policy.authtkt.hashalg': 'sha512',
    'multiauth.policy.authtkt.secret': 'GLIDING LIKE A WHALE',
    'multiauth.policy.remoteuser.use': 'encoded.authentication.NamespacedAuthenticationPolicy',
    'multiauth.policy.remoteuser.namespace': 'remoteuser',
    'multiauth.policy.remoteuser.base': 'pyramid.authentication.RemoteUserAuthenticationPolicy',
    'persona.audiences': 'http://localhost:6543',
    'persona.siteName': 'ENCODE DCC Submission',
    'load_test_only': True,
    'load_sample_data': False,
}

import logging

logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)


@fixture
def config(request):
    from pyramid.testing import setUp, tearDown
    request.addfinalizer(tearDown)
    return setUp()


@fixture
def dummy_request():
    from pyramid.testing import DummyRequest
    return DummyRequest()


@fixture(scope='session')
def app(request, connection, check_constraints):
    '''WSGI application level functional testing.
    '''
    from encoded import main
    return main({}, **app_settings)


@fixture
def collection_test():
    return {
        'awards': 39,
        'labs': 42,
        'users': 81,
        'sources': 55,
        'targets': 24,
        'antibody-lots': 25,
        'validations': 35,
        'antibodies': 25,
        'donors': 72,
        'documents': 119,
        'treatments': 6,
        'constructs': 5,
        'biosamples': 134,
    }


@fixture(scope='session')
def testdata(request, app, connection):
    tx = connection.begin_nested()
    request.addfinalizer(tx.rollback)

    from webtest import TestApp
    environ = {
        'HTTP_ACCEPT': 'application/json',
        'REMOTE_USER': 'TEST',
    }
    testapp = TestApp(app, environ)

    from ..loadxl import load_all
    from pkg_resources import resource_filename
    workbook = resource_filename('encoded', 'tests/data/test_encode3_interface_submissions.xlsx')
    docsdir = resource_filename('encoded', 'tests/data/documents/')
    load_test_only = app_settings.get('load_test_only', False)
    assert load_test_only
    load_all(testapp, workbook, docsdir, test=load_test_only)


@fixture
def htmltestapp(request, app, external_tx):
    from webtest import TestApp
    return TestApp(app)


@fixture
def testapp(request, app, external_tx):
    '''TestApp with JSON accept header.
    '''
    from webtest import TestApp
    environ = {
        'HTTP_ACCEPT': 'application/json',
        'REMOTE_USER': 'TEST',
    }
    return TestApp(app, environ)


@fixture(scope='session')
def _server(request, app):
    from webtest.http import StopableWSGIServer
    server = StopableWSGIServer.create(app)
    assert server.wait()

    @request.addfinalizer
    def shutdown():
        server.shutdown()

    return server


@fixture
def server(_server, external_tx):
    return _server


# http://docs.sqlalchemy.org/en/rel_0_8/orm/session.html#joining-a-session-into-an-external-transaction
# By binding the SQLAlchemy Session to an external transaction multiple testapp
# requests can be rolled back at the end of the test.

@fixture(scope='session')
def connection(request):
    from encoded import configure_engine
    from encoded.storage import DBSession

    engine = configure_engine(engine_settings)
    connection = engine.connect()
    DBSession.configure(bind=connection)

    @request.addfinalizer
    def close():
        connection.close()

    return connection


@fixture
def external_tx(request, connection):
    tx = connection.begin_nested()
    request.addfinalizer(tx.rollback)
    ## The database should be empty at this point
    # from encoded.storage import Base
    # for table in Base.metadata.sorted_tables:
    #     assert connection.execute(table.count()).scalar() == 0
    return tx


@fixture
def transaction(request, external_tx):
    import transaction
    request.addfinalizer(transaction.abort)
    return transaction


@fixture
def session(transaction):
    from encoded.storage import DBSession
    return DBSession()


@fixture(scope='session')
def check_constraints(request, connection):
    '''Check deffered constraints on zope transaction commit.

    Deferred foreign key constraints are only checked at the outer transaction
    boundary, not at a savepoint. With the Pyramid transaction bound to a
    subtransaction check them manually.

    Sadly SQLite does not support manual constraint checking.
    '''
    from transaction.interfaces import ISynchronizer
    from zope.interface import implementer

    @implementer(ISynchronizer)
    class CheckConstraints(object):
        def __init__(self, connection):
            self.connection = connection
            self.enabled = self.connection.engine.url.drivername != 'sqlite'

        def beforeCompletion(self, transaction):
            if self.enabled:
                self.connection.execute('SET CONSTRAINTS ALL IMMEDIATE')

        def afterCompletion(self, transaction):
            if self.enabled:
                self.connection.execute('SET CONSTRAINTS ALL DEFERRED')

        def newTransaction(self, transaction):
            pass

    constraint_checker = CheckConstraints(connection)

    import transaction
    transaction.manager.registerSynch(constraint_checker)

    @request.addfinalizer
    def unregister():
        transaction.manager.unregisterSynch(constraint_checker)


@fixture
def execute_counter(request, connection):
    """ Count calls to execute
    """
    from sqlalchemy import event

    class Counter(object):
        def __init__(self):
            self.reset()

        def reset(self):
            self.count = 0

    counter = Counter()

    @event.listens_for(connection, 'after_cursor_execute')
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        #import pytest; pytest.set_trace()
        counter.count += 1

    @request.addfinalizer
    def remove():
        # http://www.sqlalchemy.org/trac/ticket/2686
        # event.remove(connection, 'after_cursor_execute', after_cursor_execute)
        connection.dispatch.after_cursor_execute.remove(after_cursor_execute, connection)

    return counter


@fixture
def no_deps(request, connection):
    from encoded.storage import DBSession
    from sqlalchemy import event

    session = DBSession()

    @event.listens_for(session, 'after_flush')
    def check_dependencies(session, flush_context):
        #import pytest; pytest.set_trace()
        assert not flush_context.cycles


    @event.listens_for(connection, "before_execute", retval=True)
    def before_execute(conn, clauseelement, multiparams, params):
        #import pytest; pytest.set_trace()
        return clauseelement, multiparams, params

    @request.addfinalizer
    def remove():
        event.remove(session, 'before_flush', check_dependencies)
