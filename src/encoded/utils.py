# utility functions

import datetime
import time


def compute_set_difference_one(s1, s2):
    """ Computes the set difference between s1 and s2 (ie: in s1 but not in s2)
        PRE: s1 and s2 differ by one element and thus their set
        difference is a single element

        :arg s1 (set(T)): super set
        :arg s2 (set(T)): subset
        :returns (T): the single differing element between s1 and s2.
        :raises: exception if more than on element is found
    """
    res = s1 - s2
    if len(res) > 1:
        raise RuntimeError('Got more than one result for set difference')
    return next(iter(res))


def find_other_in_pair(element, pair):
    """ Wrapper for compute_set_difference_one

        :arg element (T): item to look for in pair
        :arg pair (2-tuple of T): pair of things 'element' is in
        :returns (T): item in pair that is not element
        :raises: exception if types do not match or in compute_set_diferrence_one
    """
    return compute_set_difference_one(set(pair), {element})


def delay_rerun(*args):
    """ Rerun function for flaky """
    time.sleep(1)
    return True


def utc_today_str():
    return datetime.datetime.strftime(datetime.datetime.utcnow(), "%Y-%m-%d")


def use_fixtures(*fixtures):
    """
    This declares that the fixtures are used. Mentioning them in the call is sufficient.
    Without doing this, the PyCharm code analyzer can't tell that a Python fixtures is getting used
    because it looks like a bound variable, not a use of a free variable, so the corresponding import
    will be seem to be doing nothing, when in fact pytest is bypassing language semantics and supplying
    an argument based on the fixture name in the argument list.
    """
    def fixture_consumer(func):
        return func
    return fixture_consumer
