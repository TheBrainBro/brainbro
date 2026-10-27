#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""

import sys

from dotenv import load_dotenv


def main():
    load_dotenv()

    from config.env import set_settings_module

    set_settings_module()

    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
