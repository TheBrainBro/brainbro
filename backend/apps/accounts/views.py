from django.contrib.auth import authenticate, login, logout
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


class UserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.EmailField()
    is_staff = serializers.BooleanField()


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)


@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def session(request):
    """
    Current session state. Also sets the csrftoken cookie, so the frontend
    calls this first and then sends the token in X-CSRFToken.
    """
    if not request.user.is_authenticated:
        return Response({"authenticated": False, "user": None})
    return Response({"authenticated": True, "user": UserSerializer(request.user).data})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    # DRF only enforces CSRF for already-authenticated sessions; enforce it
    # here too to prevent login CSRF.
    SessionAuthentication().enforce_csrf(request)
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = authenticate(request, **serializer.validated_data)
    if user is None:
        return Response(
            {"detail": "Invalid username or password."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    login(request, user)
    return Response({"authenticated": True, "user": UserSerializer(user).data})


@api_view(["POST"])
def logout_view(request):
    logout(request)
    return Response(status=status.HTTP_204_NO_CONTENT)
