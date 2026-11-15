import logging


class DropQueryString(logging.Filter):
    """
    Keeps the query string out of uvicorn's access log: it carries what
    people search for and the codes of an OAuth sign-in, which whoever reads
    the server's logs should not see. The path stays.
    """

    def filter(self, record):
        # uvicorn logs (client, method, path with query, HTTP version, status).
        args = record.args
        if isinstance(args, tuple) and len(args) == 5 and isinstance(args[2], str):
            record.args = (*args[:2], args[2].split("?", 1)[0], *args[3:])
        return True
