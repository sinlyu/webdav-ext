the stub works now. that means i can open reference found in plugin-api.stubs.php
- following errors happen tho:

- when trying to "go to definition" this happens:

Unable to open 'plugin-api.stubs.php'
Unable to read file '/webdav:/.stubs/plugin-api.stubs.php' (Unavailable (FileSystemError): Error: No file system handle registered (/webdav:))

also i have to open the virtal file plugin-api.stubs.php once to get the ref detection working, can we fix this? maybe by fake opening it or smth when loading it the first the by the command.