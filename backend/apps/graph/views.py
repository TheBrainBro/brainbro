from rest_framework.response import Response
from rest_framework.views import APIView

from .graph import build_graph


class GraphView(APIView):
    """`GET`: the current user's items and collections and what ties them."""

    def get(self, request):
        return Response(build_graph(request.user))
