from .changes import collect


class ChangesMiddleware:
    """
    What a request changes goes out as one message when it ends, marked with
    the tab that sent it (`X-BrainBro-Tab`), which already shows it.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        with collect(tab=request.headers.get("X-BrainBro-Tab", "")):
            return self.get_response(request)
