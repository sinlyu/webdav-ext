<?php

// This is a stub file for IDE support.
// @generated

namespace edoc\appserver\services;

class DocumentService extends \edoc\appserver\services\EdocService
{
    protected function getConfigKey(): string {}
    protected function getConfigKeySecret(): string {}
    public static function GetInstance(): \self {}
    /**
     * @throws \Exception
     */
    protected function handleError(\Psr\Http\Message\ResponseInterface $response, array $wantedStatus = []): void {}
    public function request(string $method, string $path, array $options = []): \Psr\Http\Message\ResponseInterface {}
    public function getLabel(array $label): string {}
    public function mapDocumentProperties(array $doc): array {}
    public function getSchemaDetails($schemaName) {}
    public function getDocumentsBySchema($schemaName, $pageSize = 10000, $page = 1) {}
    public function getDocumentsBySchemaSince($schemaName, $createdSince) {}
    public function getDocument($documentId, &$responseHeaders) {}
    public function getDocumentByExternalId($documentId, $schemaName) {}
    public function getDocumentContent($documentId, &$responseHeaders) {}
    public function getDocumentOcr($documentId, $refresh = false) {}
    public function newDocument($schemaName, array $attributes, $fileContents, $fileName = '') {}
    public function saveDocument($schemaName, $fileContents, $fileName = '') {}
    public function updateAttributes($documentId, $schema, $attributes = []) {}
    public function getSchemaList(bool $noCache = false): array {}
    public function getSchemas() {}
    public function getSchema(string $schemaName) {}
    public function saveSchema(string $schemaName, array $data): void {}
    public function deleteSchema(string $schemaName): void {}
    public function getSchemaWebhooks(string $schemaName, string $appName) {}
    public function saveSchemaWebhooks(string $schemaName, string $appName, array $data): void {}
    public function deleteSchemaWebhooks(string $schemaName, string $appName): void {}
    public function deleteDocument($documentId) {}
}
namespace edoc\appserver\services;

abstract class EdocService
{
    abstract protected function getConfigKey(): string;
    abstract protected function getConfigKeySecret(): string;
    public function __construct() {}
    protected function getBaseUrl(): string {}
    protected function getApiSecret(): string {}
    protected function getDefaultHeaders(): array {}
    protected function getClient(): \GuzzleHttp\Client {}
    protected function handleError(\Psr\Http\Message\ResponseInterface $response, array $wantedStatus = []): void {}
    public function request(string $method, string $path, array $options): \Psr\Http\Message\ResponseInterface {}
}
namespace edoc\appserver\app;

class AppEntity
{
}
namespace edoc\appserver\app;

abstract class AbstractValidator implements \JsonSerializable
{
    public function jsonSerialize(): mixed {}
    public static function list(): array {}
    /**
     * AbstractValidator constructor.
     *
     * @param AbstractAction|null $parent
     * @param array $config
     */
    final public function __construct(?\edoc\appserver\app\AbstractAction $parent, array $config) {}
    /**
     * Add a parameter
     *
     * @param string $name
     * @param string $type
     * @param string $defaultValue
     */
    protected function addParameter(string $name, string $type, $defaultValue = ''): void {}
    /**
     * Get all validator parameters
     * @return array
     */
    public function parameters(): array {}
    public static function addJSCallbacks(): void {}
    /**
     * @param AbstractAction|null $parent
     * @param array $config
     *
     * @return AbstractValidator|null
     */
    public static function create(?\edoc\appserver\app\AbstractAction $parent, array $config): ?\edoc\appserver\app\AbstractValidator {}
    /**
     * @param string $fieldId
     * @param  $value
     *
     * @return bool
     */
    public function validate(string $fieldId, $value): bool {}
    abstract protected function exec($value): bool;
    abstract protected function init(): void;
    /**
     * Update the message returned to the HTML DOM
     *
     * @param string|null $message
     *
     * @return void
     */
    protected function setMessage(?string $message): void {}
    /**
     * Get the current message
     * @return string
     */
    public function message(): string {}
    /**
     * Get the id of the current component
     * @return string
     */
    protected function currentComponentId(): string {}
    protected function mapParamName($name): string {}
    /**
     * Get current parameter value
     *
     * @param string $name
     *
     * @return false|mixed
     */
    protected function param(string $name): mixed {}
}
namespace edoc\appserver\app;

/**
 * AbstractComponent-Klasse
 *
 * @param TEXT $Value Gibt den aktuellen Wert der Komponente an.
 */
abstract class AbstractComponent extends \edoc\appserver\app\EntityWithRoutes
{
    use \edoc\appserver\utils\BitwiseFlags;

    public function getOptions(): array {}
    public function docs(): array {}
    public static function fixName($name) {}
    /**
     * AbstractComponent constructor.
     *
     * @param  array                  $config
     * @param  AbstractComponent|null $parent
     * @param  $mode
     * @throws \Exception
     */
    final public function __construct(array $config, ?\edoc\appserver\app\AbstractComponent &$parent = NULL, $mode = 0, ?\Monolog\Logger $logger = NULL, $initValue = true) {}
    /**
     * @param $mode
     */
    public function setRenderMode($mode) {}
    public function basicId() {}
    abstract protected function init();
    /**
     * @param string         $event
     * @param AbstractAction $action
     */
    public function registerEvent(string $event, \edoc\appserver\app\AbstractAction $action) {}
    public function events($withLoad = false, $includeChildren = false) {}
    public function isEventDisabled(string $event, bool $inherit = true): bool {}
    public function disableEvent(string $event): void {}
    public function enableEvent(string $event): void {}
    public static function setCurrentValue($id, $value) {}
    /**
     * returns events from all loaded components
     *
     * @return array
     */
    public static function registeredEvents() {}
    public static function registeredEventsById($id) {}
    /**
     * clears all registered events!
     */
    public static function clearRegisteredEvents($keepComponentId = NULL) {}
    public static function enableOnload($enable = true) {}
    public function __debugInfo() {}
    /**
     * @return string|null
     */
    public function id() {}
    /**
     * @return mixed|null
     */
    public function name() {}
    /**
     * @return string
     */
    public function realName() {}
    /**
     * @return mixed
     * @throws \Exception
     */
    public function value() {}
    public function namedValue($name) {}
    /**
     * @return AbstractComponent|null
     */
    public function parent() {}
    public function getDocReadyEventName() {}
    public function execEvent($event = 'load') {}
    /**
     * @param  $name
     * @param null $default
     *
     * @return mixed|null
     * @throws Exception
     */
    public function param($name, $default = NULL) {}
    public function defaultParam($name, $value) {}
    /**
     * @param $name
     * @param $value
     */
    public function setParam($name, $value) {}
    /**
     * @param $value
     */
    public function setValue($value, $name = NULL) {}
    public function tags() {}
    public function setTags($tags) {}
    /**
     * @return string
     */
    public function group() {}
    /**
     * @return mixed|null
     * @throws \Exception
     */
    public function label() {}
    /**
     * @param  $name
     * @return bool|AbstractComponent
     * @throws \Exception
     */
    public function getComponentByName($name) {}
    /**
     * @param  $id
     * @return bool|AbstractComponent
     * @throws Exception
     */
    public function getComponentById($id) {}
    /**
     * @param  $event
     * @return Actions
     */
    public function getActionsByEvent($event) {}
    /**
     * @return array
     */
    public function properties() {}
    public function getActions() {}
    public function setVisibility($visibility = true) {}
    public function getVisibility() {}
    public function html() {}
    protected function containerNode(array $attributes, string $content): string {}
    abstract public function htmlContent();
    protected function isEmbedded() {}
    /**
     * @param  $config
     * @param  $isEmbedded
     * @return AbstractComponent|null
     * @throws \Exception
     */
    protected function createComponent($config, $execLoad = false, $addAsChild = true): ?\edoc\appserver\app\AbstractComponent {}
    protected function setAddAsChildRowAndCol($row, $col = NULL, $pos = NULL) {}
    protected function currentAddChildRow() {}
    protected function currentAddChildCol() {}
    protected function currentAddChildPos() {}
    protected function addAsChild($component) {}
    public function isBase() {}
    public function setBase($base = true) {}
    protected function setEmbedded($embedded = true) {}
    /**
     * @return int
     */
    protected function renderMode() {}
    protected function setMetadata($name, $description, $icon) {}
    public function getMetadata() {}
    /**
     * @param $group
     */
    protected function setGroup($group) {}
    /**
     * @param $name
     * @param $type
     * @param array $options
     * @param mixed $defaultValue
     *
     * @throws \Exception
     */
    protected function addProperty($name, $type, array $options = [], $defaultValue = NULL, $hidden = false) {}
    protected function hideProperty($name) {}
    protected function addNamedValue($name) {}
    public function getNamedValues() {}
    protected function addRawProperty($name, $value) {}
    /**
     * @param $script
     * @param string $type
     */
    public function appendScript($script, $type = 'text/javascript'): void {}
    /**
     * @return array
     */
    public function getAppendScripts() {}
    /**
     * @param $file
     * @param string $type
     * @throws \ReflectionException
     */
    public function appendScriptFile($file, $type = 'text/javascript', $bottom = false): void {}
    public function addHeadScriptFile($file, $type = 'text/javascript'): void {}
    /**
     * @param $file
     * @throws \ReflectionException
     */
    public function appendStylesheet($file): void {}
    public function getStylesheets() {}
    /**
     * @param $url
     * @param string $method
     * @param callable|null $callback
     * @throws \ReflectionException
     */
    public function addApiEndpoint($url, $method, string $callback) {}
    public function getApiEndpoints() {}
    public function isReplication() {}
    public function replicationRow() {}
    public function replicationComponentId() {}
    public function setReplication($rowId) {}
    public function isView() {}
    public function setCurrentRepetitionRow($row) {}
    public function currentRepetitionRow() {}
    protected function setRouteParameter(array $params) {}
    protected function app(): \edoc\appserver\App {}
    public static function iterateChildComponents(array $config, callable $callback, bool $recursive = false): void {}
    public function addFlag($flag) {}
    public function removeFlag($flag) {}
    public function isFlagSet($flag) {}
}
namespace edoc\appserver\app;

trait GetComponentId
{
    protected function parentReplication(): ?\edoc\appserver\app\AbstractComponent {}
    /**
     * @param $fieldId
     * @return string
     */
    protected function getRealId(string $fieldId, $addBaseComponent = true): string {}
    protected function getParentViewId(?\edoc\appserver\app\AbstractComponent $current, ?string &$replicationCompRow, ?int &$replicationCompLevel): ?string {}
}
namespace edoc\appserver\app;

trait ExecParamAction
{
    abstract public function parent(): ?\edoc\appserver\app\AbstractComponent;
    abstract protected function logger(): ?\Monolog\Logger;
    protected function getActionResult(\edoc\appserver\app\AbstractAction $action, $actionConfig): mixed {}
    protected function execParamAction($param, ?\edoc\appserver\app\AbstractAction &$action = NULL) {}
}
namespace edoc\appserver\app;

/**
 * Class Action
 *
 * @package edoc\appserver
 */
abstract class AbstractAction
{
    use \edoc\appserver\app\ExecParamAction;
    use \edoc\appserver\app\GetComponentId;

    protected function logger(): ?\Monolog\Logger {}
    public function getActionLogger(): \edoc\appserver\app\logging\ActionLogger {}
    public function __debugInfo() {}
    protected function translateParams(array $names) {}
    public function getLanguageKeys() {}
    /**
     * AbstractAction constructor.
     *
     * @param array|null $config
     * @param AbstractComponent|null $parent
     */
    final public function __construct(?\edoc\appserver\app\AbstractComponent $parent, ?array $config = NULL, ?\Monolog\Logger $logger = NULL) {}
    protected function initParameterActions() {}
    public function displayName() {}
    public function setParent(?\edoc\appserver\app\AbstractComponent $parent) {}
    /**
     * @param Logger $logger
     */
    public function setLogger(\Monolog\Logger $logger) {}
    abstract protected function init();
    /**
     * This function returns an array of javascript callbacks.
     * each callback has to be a function like this: function(param){...}
     */
    public static function addJSCallbacks() {}
    public function name() {}
    public function getJsonObject() {}
    /**
     * @param $value
     */
    public function setElementValue($value) {}
    public function getParameters() {}
    public function hasReturnFields() {}
    /**
     * @param bool $render
     */
    public function setRenderResponse($render = true) {}
    protected function config() {}
    /**
     * @return mixed
     */
    protected function elementValue() {}
    protected function addParameter(?string $name, string $type, array $options = [], bool $required = false): void {}
    protected function setReturnFields($set = true) {}
    protected function requiredFields(): array {}
    protected function mapParamName($name): string {}
    /**
     * @param  $name
     * @return mixed
     * @throws \Exception
     */
    protected function param($name, $translate = false) {}
    /**
     * @param  $name
     * @return array
     * @throws \Exception
     */
    protected function paramList($name) {}
    /**
     * @return int
     */
    protected function paramCount() {}
    protected function validateParamActionResult($name, $value) {}
    /**
     * @return AbstractAction|null
     * @throws ActionNotFoundException|InvalidActionConfigurationException
     */
    public static function create(array $config, ?\edoc\appserver\app\AbstractComponent $parent, ?\Monolog\Logger $logger = NULL, int $executionMethod = 1): ?\edoc\appserver\app\AbstractAction {}
    protected function execValidations(array $validations): bool {}
    protected function validateComponent($id, \edoc\appserver\app\AbstractValidator $validator): bool {}
    /**
     * @return AbstractAction
     * @throws \ReflectionException
     */
    public function run(int $executionMethod = 1): \edoc\appserver\app\AbstractAction {}
    /**
     * @return AbstractAction
     */
    abstract protected function exec(): \edoc\appserver\app\AbstractAction;
    protected function returnField($name) {}
    /**
     * @return array|mixed
     */
    public function returnFields() {}
    /**
     * @return AbstractComponent|null
     */
    public function parent(): ?\edoc\appserver\app\AbstractComponent {}
    /**
     * @return $this
     * @deprecated use returnEnd()!
     */
    protected function noReturn() {}
    protected function returnEnd() {}
    /**
     * @param string $errorMessage
     * @param mixed|null $errorCode
     * @return $this
     */
    protected function returnError(string $errorMessage, $errorCode = NULL) {}
    protected function returnRenderComponent(\edoc\appserver\app\AbstractComponent $component) {}
    protected function returnDownload($content, $filename, $mimetype) {}
    /**
     * @return bool
     */
    protected function renderResponse(): bool {}
    protected function findComponent($componentId) {}
    /**
     * @throws \ReflectionException
     * @throws InvalidActionConfigurationException
     * @throws ActionNotFoundException
     * @throws Exception
     */
    protected function buildViewURL(array $route, bool $addServerAddr = true): string {}
    public function docs(): array {}
    public function logInfo(): array {}
    /**
     * @param QuickAddAction $action
     * @return void
     */
    protected function addQuickAddAction(\edoc\appserver\app\QuickAddAction $action): void {}
    /**
     * @return QuickAddAction[]
     */
    public function getQuickAddActions(): array {}
    public function setExecutionMethod(int $method) {}
    public function executionMethod(): int {}
    protected function getActionResult(\edoc\appserver\app\AbstractAction $action, $actionConfig): mixed {}
    protected function execParamAction($param, ?\edoc\appserver\app\AbstractAction &$action = NULL) {}
    protected function parentReplication(): ?\edoc\appserver\app\AbstractComponent {}
    /**
     * @param $fieldId
     * @return string
     */
    protected function getRealId(string $fieldId, $addBaseComponent = true): string {}
    protected function getParentViewId(?\edoc\appserver\app\AbstractComponent $current, ?string &$replicationCompRow, ?int &$replicationCompLevel): ?string {}
}
namespace edoc\appserver\app;

/**
 *
 */
class ActionHelper
{
    /**
     * @param AbstractAction $parent
     */
    public function __construct(?\edoc\appserver\app\AbstractAction $parent, ?\Monolog\Logger $logger) {}
    /**
     * @param string $actionName
     * @param array $params
     * @param $returnFields
     * @param $returnType
     * @return null
     * @throws \ReflectionException
     */
    public function exec(string $actionName, array $params, ?array $returnFields = NULL, &$returnType = NULL) {}
    public function isSingleValue($value) {}
    public function isDataset($value) {}
}
namespace edoc\appserver\app;

class EntityWithRoutes extends \edoc\appserver\app\AppEntity
{
    protected function setRoutes($routes): void {}
    public function routes(): array {}
}
namespace edoc\appserver\datasources\driver;

class RestAPI extends \edoc\appserver\datasources\RestAPI implements \edoc\appserver\datasources\ConnectionHandler
{
    protected function init() {}
    public function details() {}
    public function post($url, $data, $header = [], &$responseHeader = NULL) {}
}
namespace edoc\appserver\datasources;

abstract class RestAPI extends \edoc\appserver\datasources\DataSource implements \edoc\appserver\datasources\ConnectionHandler
{
    public function addRequesOption($name, $value) {}
    protected function initAPI($host) {}
    protected function processResponse(string $url, int $status, string $body, array $header): string {}
    public function requestGet($url, $headerFields = [], &$responseHeader = NULL) {}
    public function requestPost($url, $postData, $headerFields = [], &$responseHeader = NULL) {}
    public function requestPatch($url, $postData, $headerFields = [], &$responseHeader = NULL) {}
    public function requestDelete($url, $postData, $headerFields = [], &$responseHeader = NULL) {}
    public function requestPut($url, $postData, $headerFields = [], &$responseHeader = NULL) {}
    public function handle(): ?\CurlHandle {}
}
namespace edoc\appserver\datasources;

interface ConnectionHandler
{
    /**
     * @template T
     * @return T
     */
    abstract public function handle();
}
namespace edoc\appserver\datasources;

/**
 * Class DataSource
 *
 * @package edoc\appserver\datasources
 */
abstract class DataSource
{
    abstract protected function init();
    protected static function catchPluginError(string $type, string $class, string $appName, string $pluginName, \Throwable $exception): void {}
    public static function catchPluginErrors(bool $enable = true): void {}
    public static function getPluginErrors(): array {}
    public static function list() {}
    public static function findNameById(string $id): string {}
    public function properties() {}
    public static function getRawInstance($dsName) {}
    /**
     * @param  $name
     * @return bool|mixed
     * @throws Exception
     */
    public static function getInstance($name, $instanceType = NULL) {}
    /**
     * @param array $params
     */
    public function setParams(array $params) {}
    /**
     * @return array
     */
    abstract public function details();
    public function isReady() {}
    protected function setReady($ready = true) {}
    public function errorMessage() {}
    protected function addProperty($name, $type, $defaultValue = NULL, array $options = []) {}
    protected function setErrorMessage($message) {}
    public function docs(): array {}
}
namespace edoc\appserver\datasources;

abstract class Database extends \edoc\appserver\datasources\DataSource
{
    public function getLastParsedQuery(): ?string {}
    abstract public function querySingle($SQL);
    abstract public function query($SQL);
    abstract public function lastInsertId();
    abstract public function escape($string, bool &$addedQuotes);
    /**
     * @param  $Sql
     * @return string|string[]|null
     */
    protected function parseQuery($Sql) {}
}