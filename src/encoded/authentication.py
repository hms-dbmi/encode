import base64
import os
from operator import itemgetter

from passlib.context import CryptContext
from pyramid.authentication import (
    BasicAuthAuthenticationPolicy as _BasicAuthAuthenticationPolicy,
)
from pyramid.path import (
    DottedNameResolver,
    caller_package,
)
from pyramid.security import (
    NO_PERMISSION_REQUIRED,
    remember,
    forget,
)
from pyramid.httpexceptions import (
    HTTPForbidden,
)
from pyramid.view import (
    view_config,
)
from pyramid.settings import (
    asbool,
    aslist,
)
from snovault import ROOT
from snovault.storage import User
from snovault import COLLECTIONS
from snovault.calculated import calculate_properties

CRYPT_CONTEXT = __name__ + ':crypt_context'


def includeme(config):
    config.include('.edw_hash')
    setting_prefix = 'passlib.'
    passlib_settings = {
        k[len(setting_prefix):]: v
        for k, v in config.registry.settings.items()
        if k.startswith(setting_prefix)
    }
    if not passlib_settings:
        passlib_settings = {'schemes': 'edw_hash, unix_disabled'}
    crypt_context = CryptContext(**passlib_settings)
    config.registry[CRYPT_CONTEXT] = crypt_context

    # basic login route
    config.add_route('login', '/login')
    config.add_route('logout', '/logout')
    config.add_route('session-properties', '/session-properties')
    config.scan(__name__)


class NamespacedAuthenticationPolicy(object):
    """ Wrapper for authentication policy classes

    As userids are included in the list of principals, it seems good practice
    to namespace them to avoid clashes.

    Constructor Arguments

    ``namespace``

        The namespace used (string).

    ``base``

        The base authentication policy (class or dotted name).

    Remaining arguments are passed to the ``base`` constructor.

    Example

    To make a ``REMOTE_USER`` 'admin' be 'user.admin'

    .. code-block:: python

        policy = NamespacedAuthenticationPolicy('user',
            'pyramid.authentication.RemoteUserAuthenticationPolicy')
    """

    def __new__(cls, namespace, base, *args, **kw):
        # Dotted name support makes it easy to configure with pyramid_multiauth
        name_resolver = DottedNameResolver(caller_package())
        base = name_resolver.maybe_resolve(base)
        # Dynamically create a subclass
        name = 'Namespaced_%s_%s' % (namespace, base.__name__)
        klass = type(name, (cls, base), {'_namespace_prefix': namespace + '.'})
        return super(NamespacedAuthenticationPolicy, klass).__new__(klass)

    def __init__(self, namespace, base, *args, **kw):
        super(NamespacedAuthenticationPolicy, self).__init__(*args, **kw)

    def unauthenticated_userid(self, request):
        cls  = super(NamespacedAuthenticationPolicy, self) 
        userid = super(NamespacedAuthenticationPolicy, self) \
            .unauthenticated_userid(request)
        if userid is not None:
            userid = self._namespace_prefix + userid
        return userid

    def remember(self, request, principal, **kw):
        if not principal.startswith(self._namespace_prefix):
            return []
        principal = principal[len(self._namespace_prefix):]
        return super(NamespacedAuthenticationPolicy, self) \
            .remember(request, principal, **kw)


class BasicAuthAuthenticationPolicy(_BasicAuthAuthenticationPolicy):
    def __init__(self, check, *args, **kw):
        # Dotted name support makes it easy to configure with pyramid_multiauth
        name_resolver = DottedNameResolver(caller_package())
        check = name_resolver.maybe_resolve(check)
        #check = snovault_auth_check
        super(BasicAuthAuthenticationPolicy, self).__init__(check, *args, **kw)

    '''def unauthenticated_userid(self, request):
        print("called unauthenticated with", request.json)
        return "user.admin"
    '''

class LoginDenied(HTTPForbidden):
    title = 'Login failure'

@view_config(route_name='login', request_method='POST',
             permission=NO_PERMISSION_REQUIRED)
def login(request):
    properties = {"login":"success"}

    #username == email
    login = request.json.get("username")
    password = request.json.get("password")
    if not User.check_password(login, password):
        request.response.headerlist.extend(forget(request))
        raise LoginDenied()
    else: 
        request.response.headerlist.extend(remember(request, 'mailto.' + login))
        properties = request.embed('/session-properties', as_user=login)
        if 'auth.userid' in request.session:
            properties['auth.userid'] = request.session['auth.userid']
    print(properties)
    return properties

@view_config(route_name='logout',
             permission=NO_PERMISSION_REQUIRED, http_cache=0)
def logout(request):
    """View to forget the user"""
    request.session.invalidate()
    request.response.headerlist.extend(forget(request))
    if asbool(request.params.get('redirect', True)):
        raise HTTPFound(location=request.resource_path(request.root))
    return {}

@view_config(route_name='session-properties', request_method='GET',
             permission=NO_PERMISSION_REQUIRED)
def session_properties(request):
    for principal in request.effective_principals:
        if principal.startswith('userid.'):
            break
    else:
        return {}

    namespace, userid = principal.split('.', 1)
    user = request.registry[COLLECTIONS]['user'][userid]
    user_actions = calculate_properties(user, request, category='user_action')

    properties = {
        'user': request.embed(request.resource_path(user)),
        'user_actions': [v for k, v in sorted(user_actions.items(), key=itemgetter(0))]
    }

    if 'auth.userid' in request.session:
        properties['auth.userid'] = request.session['auth.userid']

    return properties


def basic_auth_check(username, password, request):
    # We may get called before the context is found and the root set
    root = request.registry[ROOT]
    collection = root['access-keys']
    try:
        access_key = collection[username]
    except KeyError:
        return None

    properties = access_key.properties
    hash = properties['secret_access_key_hash']

    crypt_context = request.registry[CRYPT_CONTEXT]
    valid = crypt_context.verify(password, hash)
    if not valid:
        return None

    #valid, new_hash = crypt_context.verify_and_update(password, hash)
    #if new_hash:
    #    replace_user_hash(user, new_hash)

    return []


def generate_user():
    """ Generate a random user name with 64 bits of entropy
    """
    # Take a random 5 char binary string (80 bits of
    # entropy) and encode it as upper cased base32 (8 chars)
    random_bytes = os.urandom(5)
    user = base64.b32encode(random_bytes).decode('ascii').rstrip('=').upper()
    return user


def generate_password():
    """ Generate a password with 80 bits of entropy
    """
    # Take a random 10 char binary string (80 bits of
    # entropy) and encode it as lower cased base32 (16 chars)
    random_bytes = os.urandom(10)
    password = base64.b32encode(random_bytes).decode('ascii').rstrip('=').lower()
    return password
