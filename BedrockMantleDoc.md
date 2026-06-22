# OpenAI Protocol

## POST /chat/completions

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://bedrock-mantle.us-east-1.api.aws/v1",
  apiKey: "<your-api-key>",
  defaultHeaders: { "OpenAI-Project": "default" },
});

const response = await client.chat.completions.create({
  model: "openai.gpt-oss-120b",
  messages: [
    {
      role: "user",
      content: "What is Amazon Bedrock?",
    },
  ],
  max_tokens: 64,
});
console.log(response.choices[0].message.content);
```

Create chat completion
Creates a model response for the given chat conversation.

Parameter support can differ depending on the model used to generate the response, particularly for newer reasoning models. Parameters that are only supported for reasoning models are noted below.

Headers
OpenAI-Project
string
The project ID to scope requests to.

Default:
default
Body

application/json

application/json
text
object
verbosity
string or null
Constrains the verbosity of the model's response. Lower values will result in more concise responses, while higher values will result in more verbose responses. Currently supported values are low, medium, and high.

Allowed values:
low
medium
high
Default:
medium
metadata
any
[circular: ./Metadata.json]

top_logprobs
integer or null
An integer between 0 and 20 specifying the number of most likely tokens to return at each token position, each with an associated log probability. logprobs must be set to true if this parameter is used.

>= 0
<= 20
temperature
number or null
What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. We generally recommend altering this or top_p but not both.

>= 0
<= 2
Default:
1
Example:
1
top_p
number or null
An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.Show all...

>= 0
<= 1
Default:
1
Example:
1
user
string
deprecated
This field is being replaced by safety_identifier and prompt_cache_key. Use prompt_cache_key instead to maintain caching optimizations. A stable identifier for your end-users. Used to boost cache hit rates by better bucketing similar requests and to help OpenAI detect and prevent abuse.

Example:
user-1234
safety_identifier
string
A stable identifier used to help detect users of your application that may be violating OpenAI's usage policies. The IDs should be a string that uniquely identifies each user. We recommend hashing their username or email address, in order to avoid sending us any identifying information.

Example:
safety-identifier-1234
prompt_cache_key
string
Used by OpenAI to cache responses for similar requests to optimize your cache hit rates. Replaces the user field.

Example:
prompt-cache-key-1234
service_tier
any
[circular: ./ServiceTier.json]

messages
array (anyOf) [Developer message]array (anyOf) [System message]array (anyOf) [User message]array (anyOf) [Assistant message]array (anyOf) [Tool message]array (anyOf) [Function message]

array (anyOf) [Developer message]
required
Developer-provided instructions that the model should follow, regardless of messages sent by the user. With o1 models and newer, developer messages replace the previous system messages.

>= 1 items
content
Text contentarray[Text content part]

any of: Text content
required
The contents of the developer message.

role
string
required
The role of the messages author, in this case developer.

Allowed value:
developer
name
string
An optional name for the participant. Provides the model information to differentiate between participants of the same role.

model
stringstring

any of: string
required
modalities
array[string] or null
Output types that you would like the model to generate. Most models are capable of generating text, which is the default:Show all...

Allowed values:
text
audio
reasoning_effort
string or null
Constrains effort on reasoning for reasoning models. Currently supported values are minimal, low, medium, and high. Reducing reasoning effort can result in faster responses and fewer tokens used on reasoning in a response.

Allowed values:
minimal
low
medium
high
Default:
medium
max_completion_tokens
integer or null
An upper bound for the number of tokens that can be generated for a completion, including visible output tokens and reasoning tokens.

frequency_penalty
number or null
Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.

>= -2
<= 2
Default:
0
presence_penalty
number or null
Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.

>= -2
<= 2
Default:
0
web_search_options
Web search
This tool searches the web for relevant results to use in a response.

user_location
object or null
Approximate location parameters for the search.

search_context_size
string
High level guidance for the amount of context window space to use for the search. One of low, medium, or high. medium is the default.

Allowed values:
low
medium
high
Default:
medium
response_format
TextJSON schemaJSON object

any of: Text
Default response format. Used to generate text responses.

type
string
required
The type of response format being defined. Always text.

Allowed value:
text
audio
object or null
Parameters for audio output. Required when audio output is requested with modalities: ["audio"].

voice
stringstring

any of: string
required
format
string
required
Specifies the output audio format. Must be one of wav, mp3, flac, opus, or pcm16.

Allowed values:
wav
aac
mp3
flac
opus
pcm16
store
boolean or null
Whether or not to store the output of this chat completion request.Show all...

Default:
false
stream
boolean or null
If set to true, the model response data will be streamed to the client as it is generated using server-sent events.

Default:
false
stop
stringarray[string]

any of: string
Not supported with latest reasoning models o3 and o4-mini.Show all...

logit_bias
dictionary[string, integer] or null
Modify the likelihood of specified tokens appearing in the completion.Show all...

Default:
null
logprobs
boolean or null
Whether to return log probabilities of the output tokens or not. If true, returns the log probabilities of each output token returned in the content of message.

Default:
false
max_tokens
integer or null
deprecated
The maximum number of tokens that can be generated in the chat completion. This value can be used to control costs for text generated via API.Show all...

n
integer or null
How many chat completion choices to generate for each input message. Note that you will be charged based on the number of generated tokens across all of the choices. Keep n as 1 to minimize costs.

>= 1
<= 128
Default:
1
Example:
1
top_k
integer or null
Sample from the top K options for each subsequent token. Use the topK parameter to remove long tail, low probability responses.

>= 0
<= 128
Example:
50
prediction
Static Content or null
Static predicted output content, such as the content of a text file that is being regenerated.

type
string
required
The type of the predicted content you want to provide. This type is currently always content.

Allowed value:
content
content
Text contentarray

any of: Text content
required
The content used for a Predicted Output. This is often the text of a file you are regenerating with minor changes.

seed
integer or null
deprecated
This feature is in Beta. If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result. Determinism is not guaranteed, and you should refer to the system_fingerprint response parameter to monitor changes in the backend.

>= -9223372036854776000
<= 9223372036854776000
stream_options
object or null
Options for streaming response. Only set this when you set stream: true.

Default:
null
include_usage
boolean
If set, an additional chunk will be streamed before the data: [DONE] message. The usage field on this chunk shows the token usage statistics for the entire request, and the choices field will always be an empty array.Show all...

include_obfuscation
boolean
When true, stream obfuscation will be enabled. Stream obfuscation adds random characters to an obfuscation field on streaming delta events to normalize payload sizes as a mitigation to certain side-channel attacks. These obfuscation fields are included by default, but add a small amount of overhead to the data stream. You can set include_obfuscation to false to optimize for bandwidth if you trust the network links between your application and the OpenAI API.

continuous_usage_stats
boolean
BEDROCK INTERNAL vLLM field needed to enable usage stats per token batch

tools
array (anyOf) [Function tool]array (anyOf) [Custom tool]

array (anyOf) [Function tool]
A function tool that can be used to generate a response.

type
string
required
The type of the tool. Currently, only function is supported.

Allowed value:
function
function
object
required
tool_choice
AutoAllowed toolsFunction tool choiceCustom tool choice

any of: Auto
none means the model will not call any tool and instead generates a message. auto means the model can pick between generating a message or calling one or more tools. required means the model must call one or more tools.

parallel_tool_calls
boolean
Whether to enable parallel function calling during tool use.

Default:
true
function_call
function call modeobject

any of: function call mode
none means the model will not call a function and instead generates a message. auto means the model can pick between generating a message or calling a function.

functions
array[object]
deprecated
Deprecated in favor of tools.Show all...

>= 1 items
<= 128 items
description
string
A description of what the function does, used by the model to choose when and how to call the function.

name
string
required
The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.

parameters
any
[circular: ./FunctionParameters.json]

verbosity
any
[circular: ./Verbosity.json]

OK

Body
application/jsontext/event-stream

text/event-stream
responses
/
200
/
x-amazonMetering
Represents a streamed chunk of a chat completion response returned by the model, based on the provided input.

id
string
required
A unique identifier for the chat completion. Each chunk has the same ID.

choices
array[object]
required
A list of chat completion choices. Can contain more than one elements if n is greater than 1. Can also be empty for the last chunk if you set stream_options: {"include_usage": true}.

delta
object
required
A chat completion delta generated by streamed model responses.

logprobs
object or null
Log probability information for the choice.

finish_reason
string or null
required
The reason the model stopped generating tokens. This will be stop if the model hit a natural stop point or a provided stop sequence, length if the maximum number of tokens specified in the request was reached, content_filter if content was omitted due to a flag from our content filters, tool_calls if the model called a tool, or function_call (deprecated) if the model called a function.

Allowed values:
stop
length
tool_calls
content_filter
function_call
index
integer
required
The index of the choice in the list of choices.

created
integer
required
The Unix timestamp (in seconds) of when the chat completion was created. Each chunk has the same timestamp.

model
string
required
The model to generate the completion.

service_tier
any
[circular: ./ServiceTier.json]

system_fingerprint
string
deprecated
This fingerprint represents the backend configuration that the model runs with. Can be used in conjunction with the seed request parameter to understand when backend changes have been made that might impact determinism.

object
string
required
The object type, which is always chat.completion.chunk.

Allowed value:
chat.completion.chunk
usage
any
[circular: ./CompletionUsage.json]

x-amazonMetering
any
[circular: ./CompletionUsage.json]

## POST /responses

```
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://bedrock-mantle.us-east-1.api.aws/v1",
  apiKey: "<your-api-key>",
  defaultHeaders: { "OpenAI-Project": "default" },
});

const response = await client.responses.create({
  model: "openai.gpt-oss-120b",
  input: "What is Amazon Bedrock?",
  max_output_tokens: 64,
});
console.log(response.output_text);
```

Create a model response
Creates a model response. Provide text or image inputs to generate text or JSON outputs. Have the model call your own custom code or use built-in tools like web search or file search to use your own data as input for the model's response.

Headers
OpenAI-Project
string
The project ID to scope requests to.

Default:
default
Body

application/json

application/json
[circular: ./CreateModelResponseProperties.json]

previous_response_id
string or null
The unique ID of the previous response to the model. Use this to create multi-turn conversations.

model
anyResponsesOnlyModel

any of: any
[circular: ./ModelIdsShared.json]

reasoning
Reasoning
gpt-5 and o-series models onlyShow all...

effort
any
[circular: ./ReasoningEffort.json]

summary
string or null
A summary of the reasoning performed by the model. This can be useful for debugging and understanding the model's reasoning process. One of auto, concise, or detailed.

Allowed values:
auto
concise
detailed
generate_summary
string or null
deprecated
Deprecated: use summary instead.Show all...

Allowed values:
auto
concise
detailed
background
boolean or null
Whether to run the model response in the background.

Default:
false
max_output_tokens
integer or null
An upper bound for the number of tokens that can be generated for a response, including visible output tokens and reasoning tokens.

max_tool_calls
integer or null
The maximum number of total calls to built-in tools that can be processed in a response. This maximum number applies across all built-in tool calls, not per individual tool. Any further attempts to call a tool by the model will be ignored.

text
object
Configuration options for a text response from the model. Can be plain text or structured JSON data.

format
anyJSON schemaany

any of: any
[circular: ./ResponseFormatText.json]

verbosity
any
[circular: ./Verbosity.json]

tools
array (anyOf) [Function]array (anyOf) [File search]array (anyOf) [Web search preview]array (anyOf) [Computer use preview]array (anyOf) [MCP tool]array (anyOf) [Code interpreter]array (anyOf) [Image generation tool]array (anyOf) [Local shell tool]array (anyOf) [Custom tool]

array (anyOf) [Function]
Defines a function in your own code the model can choose to call.

type
string
required
The type of the function tool. Always function.

Allowed value:
function
Default:
function
name
string
required
The name of the function to call.

description
stringnull

any of: string
A description of the function. Used by the model to determine whether or not to call the function.

parameters
dictionary[string, any]null

any of: dictionary[string, any]
required
A JSON schema object describing the parameters of the function.

strict
booleannull

any of: boolean
required
Whether to enforce strict parameter validation. Default true.

tool_choice
Tool choice modeAllowed toolsHosted toolFunction toolMCP toolCustom tool

any of: Tool choice mode
Controls which (if any) tool is called by the model.Show all...

prompt
object or null
Reference to a prompt template and its variables.

id
string
required
The unique identifier of the prompt template to use.

version
string or null
Optional version of the prompt template.

variables
dictionary[string, anyOf] or null
Optional map of values to substitute in for variables in your prompt. The substitution values can either be strings, or other Response input types like images or files.

truncation
string or null
The truncation strategy to use for the model response.

auto: If the context of this response and previous ones exceeds the model's context window size, the model will truncate the response to fit the context window by dropping input items in the middle of the conversation.
disabled (default): If a model response will exceed the context window size for a model, the request will fail with a 400 error.
Allowed values:
auto
disabled
Default:
disabled
input
Text inputarray[anyOf]

any of: Text input
A text input to the model, equivalent to a text input with the user role.

include
array[string] or null
Specify additional output data to include in the model response. Currently supported values are:

code_interpreter_call.outputs: Includes the outputs of python code execution in code interpreter tool call items.
computer_call_output.output.image_url: Include image urls from the computer call output.
file_search_call.results: Include the search results of the file search tool call.
message.input_image.image_url: Include image urls from the input message.
message.output_text.logprobs: Include logprobs with assistant messages.
reasoning.encrypted_content: Includes an encrypted version of reasoning tokens in reasoning item outputs. This enables reasoning items to be used in multi-turn conversations when using the Responses API statelessly (like when the store parameter is set to false, or when an organization is enrolled in the zero data retention program).
Allowed values:
code_interpreter_call.outputs
computer_call_output.output.image_url
file_search_call.results
message.input_image.image_url
message.output_text.logprobs
reasoning.encrypted_content
parallel_tool_calls
boolean or null
Whether to allow the model to run tool calls in parallel.

Default:
true
store
boolean or null
Whether to store the generated model response for later retrieval via API.

Default:
true
instructions
string or null
A system (or developer) message inserted into the model's context.Show all...

stream
boolean or null
If set to true, the model response data will be streamed to the client as it is generated using server-sent events.

Default:
false
stream_options
object or null
Options for streaming responses. Only set this when you set stream: true.

Default:
null
include_obfuscation
boolean
When true, stream obfuscation will be enabled. Stream obfuscation adds random characters to an obfuscation field on streaming delta events to normalize payload sizes as a mitigation to certain side-channel attacks. These obfuscation fields are included by default, but add a small amount of overhead to the data stream. You can set include_obfuscation to false to optimize for bandwidth if you trust the network links between your application and the OpenAI API.

OK

Body
application/jsontext/event-stream

application/json
responses
/
200
/
parallel_tool_calls
[circular: ./ResponseProperties.json]

id
string
required
Unique identifier for this Response.

object
string
required
The object type of this resource - always set to response.

Allowed value:
response
status
string
The status of the response generation. One of completed, failed, in_progress, cancelled, queued, or incomplete.

Allowed values:
completed
failed
in_progress
cancelled
queued
incomplete
created_at
number
required
Unix timestamp (in seconds) of when this Response was created.

error
object or null
required
An error object returned when the model fails to generate a Response.

code
string
required
The error code for the response.

Allowed values:
server_error
rate_limit_exceeded
invalid_prompt
vector_store_timeout
invalid_image
invalid_image_format
invalid_base64_image
invalid_image_url
image_too_large
image_too_small
image_parse_error
image_content_policy_violation
invalid_image_mode
image_file_too_large
unsupported_image_media_type
empty_image_file
failed_to_download_image
image_file_not_found
message
string
required
A human-readable description of the error.

incomplete_details
object or null
required
Details about why the response is incomplete.

reason
string
The reason why the response is incomplete.

Allowed values:
max_output_tokens
content_filter
output
arrayarrayarrayarrayarrayarrayarrayarrayarrayarrayarrayarrayarray

array
required
[circular: ./OutputMessage.json]

instructions
stringarray

any of: string
required
A text input to the model, equivalent to a text input with the developer role.

output_text
string or null
SDK-only convenience property that contains the aggregated text output from all output_text items in the output array, if any are present. Supported in the Python and JavaScript SDKs.

usage
object
Represents token usage details including input tokens, output tokens, a breakdown of output tokens, and the total tokens used.

input_tokens
integer
required
The number of input tokens.

input_tokens_details
object
required
A detailed breakdown of the input tokens.

output_tokens
integer
required
The number of output tokens.

output_tokens_details
object
required
A detailed breakdown of the output tokens.

total_tokens
integer
required
The total number of tokens used.

parallel_tool_calls
boolean
required
Whether to allow the model to run tool calls in parallel.

Default:
true
input_messages
object
These are populated when enable_response_messages is set to True Chat Completion message objects

output_messages
object
These are populated when enable_response_messages is set to True Chat Completion message objects

This also supports GET /responses/{responseId}, DELETE /responses/{responseId} and POST /responses/{responseId}/cancel 

## POST /files

```
import OpenAI from "openai";
import fs from "node:fs";

const client = new OpenAI({
  baseURL: "https://bedrock-mantle.us-east-1.api.aws/v1",
  apiKey: "<your-api-key>",
  defaultHeaders: { "OpenAI-Project": "default" },
});

const response = await client.files.create({
  file: fs.createReadStream("train.jsonl"),
  purpose: "fine-tune",
});
console.log(response);
```

Upload file
Upload a file that can be used across various endpoints. Individual files can be up to 512 MB, and the size of all files uploaded by one organization can be up to 1 TB.

The Assistants API supports files up to 2 million tokens and of specific file types.
The Fine-tuning API only supports .jsonl files. The input also has certain required formats for fine-tuning chat or completions models.
The Batch API only supports .jsonl files up to 200 MB in size. The input also has a specific required format.
Please contact support if you need to increase these storage limits.

Headers
OpenAI-Project
string
The project ID to scope requests to.

Default:
default
Body

multipart/form-data

multipart/form-data
file
string
required
The File object (not file name) to be uploaded.

Default:
{"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]}
Example:
{"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]}
purpose
string
required
The intended purpose of the uploaded file. One of: - assistants: Used in the Assistants API - batch: Used in the Batch API - fine-tune: Used for fine-tuning - vision: Images used for vision fine-tuning - user_data: Flexible file type for any purpose - evals: Used for eval data sets

Allowed value:
fine-tune
Default:
fine-tune
Example:
fine-tune
expires_after
File expiration policy
The expiration policy for a file. By default, files with purpose=batch expire after 30 days and all other files are persisted until they are manually deleted.

anchor
string
required
Anchor timestamp after which the expiration policy applies. Supported anchors: created_at.

Allowed value:
created_at
seconds
integer
required
The number of seconds after the anchor time that the file will expire. Must be between 3600 (1 hour) and 2592000 (30 days).

>= 3600
<= 2592000
OK

Body

application/json

application/json
any
[circular: ../components/schemas/OpenAIFile.json]

It also supports GET /files and DELETE /files/{file_id}

## POST /organization/projects  

```
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://bedrock-mantle.us-east-1.api.aws/v1",
  apiKey: "<your-api-key>",
  defaultHeaders: { "OpenAI-Project": "default" },
});

const response = await client.organization.projects.create({
  name: "my-project",
});
console.log(response);
```

Create Project
Headers
OpenAI-Project
string
The project ID to scope requests to.

Default:
default
Body

application/json

application/json
The project create request payload.

name
string
required
The friendly name of the project, this name appears in reports.

tags
any
[circular: ./ProjectTags.json]

Project created successfully.

Body

application/json

application/json
any
[circular: ../components/schemas/Project.json]
