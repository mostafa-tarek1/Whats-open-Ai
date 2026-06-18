# 24 - Hafez Server Laravel Integration

This guide connects a Laravel application to the deployed OpenWA instance at
`hafez.azq1.com`. It covers API access, WhatsApp OTP delivery, webhooks, testing,
and an implementation contract that another coding agent can follow directly.

> OpenWA uses WhatsApp Web, not the official Meta WhatsApp Business API. Keep
> SMS or email as a fallback for critical authentication flows.

## Deployment Contract

| Service | URL |
| --- | --- |
| Dashboard | `https://hafez.azq1.com` |
| API root | `https://hafez.azq1.com/openwa/api` |
| Health check | `https://hafez.azq1.com/openwa/api/health` |
| Swagger UI | `https://hafez.azq1.com/openwa/api/docs` |
| Authentication header | `X-API-Key: <key>` |

The API root already ends with `/api`. Laravel requests must therefore use
relative paths such as `sessions/{id}/messages/send-text`.

Do not build URLs like this:

```text
https://hafez.azq1.com/openwa/api/api/sessions/...
```

Do not begin the relative Laravel request path with `/`. Keeping a trailing
slash on the configured base URL and using `sessions/...` avoids URL resolution
problems.

## Prerequisites

1. Open the dashboard at `https://hafez.azq1.com`.
2. Confirm that the target WhatsApp session has the status `ready`.
3. Create an API key with the `operator` role.
4. Restrict the key to the Laravel server IP and target session when possible.
5. Store the full key when it is created. The full value is displayed only once.
6. Never expose the API key in JavaScript, a mobile application, or a public Git repository.

An `admin` key is required only to manage other API keys. The Laravel
application should use an `operator` key.

## Server Smoke Tests

Set temporary shell variables:

```bash
export OPENWA_API_URL='https://hafez.azq1.com/openwa/api'
export OPENWA_API_KEY='owa_k1_replace_me'
export OPENWA_SESSION_ID='replace-with-session-uuid'
```

Check the API:

```bash
curl -sS "$OPENWA_API_URL/health"
```

Expected shape:

```json
{"status":"ok","timestamp":"2026-06-18T00:00:00.000Z"}
```

List sessions and copy the `id` of a session whose status is `ready`:

```bash
curl -sS \
  -H "X-API-Key: $OPENWA_API_KEY" \
  "$OPENWA_API_URL/sessions"
```

Check whether an international phone number is registered on WhatsApp:

```bash
curl -sS \
  -H "X-API-Key: $OPENWA_API_KEY" \
  "$OPENWA_API_URL/sessions/$OPENWA_SESSION_ID/contacts/check/201500000000"
```

Send a test message:

```bash
curl -sS -X POST \
  -H "X-API-Key: $OPENWA_API_KEY" \
  -H "Content-Type: application/json" \
  "$OPENWA_API_URL/sessions/$OPENWA_SESSION_ID/messages/send-text" \
  -d '{
    "chatId": "201500000000@c.us",
    "text": "OpenWA integration test"
  }'
```

A successful send returns HTTP `201` with this shape:

```json
{
  "messageId": "true_201500000000@c.us_...",
  "timestamp": 1781740800
}
```

Use the international number without `+`, spaces, or a leading zero. For
example, an Egyptian local number beginning with `015...` must be converted to
`2015...` before it reaches the OpenWA client.

## Laravel Configuration

Add these values to the Laravel `.env` file:

```env
OPENWA_API_URL=https://hafez.azq1.com/openwa/api
OPENWA_API_KEY=owa_k1_replace_me
OPENWA_SESSION_ID=replace-with-session-uuid
OPENWA_WEBHOOK_SECRET=replace-with-a-long-random-value
```

Do not add quotes unless the value itself contains spaces.

Add the integration to `config/services.php`:

```php
'openwa' => [
    'url' => env('OPENWA_API_URL', 'https://hafez.azq1.com/openwa/api'),
    'key' => env('OPENWA_API_KEY'),
    'session_id' => env('OPENWA_SESSION_ID'),
    'webhook_secret' => env('OPENWA_WEBHOOK_SECRET'),
],
```

After changing production environment values, refresh Laravel's cached
configuration:

```bash
php artisan optimize:clear
php artisan config:cache
```

## OpenWA Laravel Client

Create `app/Services/OpenWaClient.php`:

```php
<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;

final class OpenWaClient
{
    private function request(): PendingRequest
    {
        return Http::baseUrl(
            rtrim((string) config('services.openwa.url'), '/').'/'
        )
            ->acceptJson()
            ->asJson()
            ->withHeaders([
                'X-API-Key' => (string) config('services.openwa.key'),
            ])
            ->connectTimeout(5)
            ->timeout(15);
    }

    public function listSessions(): array
    {
        return (array) $this->request()
            ->get('sessions')
            ->throw()
            ->json();
    }

    public function getSession(?string $sessionId = null): array
    {
        $sessionId = $this->sessionId($sessionId);

        return (array) $this->request()
            ->get('sessions/'.rawurlencode($sessionId))
            ->throw()
            ->json();
    }

    public function checkNumber(string $phone, ?string $sessionId = null): bool
    {
        $sessionId = $this->sessionId($sessionId);
        $number = $this->normalizeNumber($phone);

        return (bool) $this->request()
            ->get(
                'sessions/'.rawurlencode($sessionId).
                '/contacts/check/'.rawurlencode($number)
            )
            ->throw()
            ->json('exists');
    }

    public function sendText(
        string $phone,
        string $message,
        ?string $sessionId = null
    ): array {
        $sessionId = $this->sessionId($sessionId);

        return (array) $this->request()
            ->post(
                'sessions/'.rawurlencode($sessionId).'/messages/send-text',
                [
                    'chatId' => $this->normalizeNumber($phone).'@c.us',
                    'text' => $message,
                ]
            )
            ->throw()
            ->json();
    }

    private function sessionId(?string $sessionId): string
    {
        $sessionId ??= (string) config('services.openwa.session_id');

        if ($sessionId === '') {
            throw new InvalidArgumentException(
                'OPENWA_SESSION_ID is not configured.'
            );
        }

        return $sessionId;
    }

    private function normalizeNumber(string $phone): string
    {
        $number = preg_replace('/\D+/', '', $phone) ?? '';

        if (
            $number === '' ||
            str_starts_with($number, '0') ||
            strlen($number) < 8 ||
            strlen($number) > 15
        ) {
            throw new InvalidArgumentException(
                'Phone must be an international number with country code.'
            );
        }

        return $number;
    }
}
```

The client intentionally does not automatically retry `sendText()`. A timeout
can happen after WhatsApp has accepted a message, so blindly retrying a POST can
deliver the same OTP twice. Handle retries through a queue job with an explicit
idempotency policy.

## Secure OTP Service

Laravel must generate, store, rate-limit, and verify the OTP. OpenWA is only the
delivery transport.

Create `app/Services/WhatsAppOtpService.php`:

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;
use Throwable;

final class WhatsAppOtpService
{
    public function __construct(private OpenWaClient $openWa)
    {
    }

    public function send(string $phone): void
    {
        $number = $this->normalizeNumber($phone);
        $cooldownKey = 'otp-send:'.$number;
        $otpKey = 'otp-code:'.$number;

        if (! Cache::add($cooldownKey, true, now()->addSeconds(60))) {
            throw ValidationException::withMessages([
                'phone' => 'Please wait before requesting another code.',
            ]);
        }

        $otp = (string) random_int(100000, 999999);
        $hash = hash_hmac('sha256', $otp, (string) config('app.key'));

        Cache::put($otpKey, $hash, now()->addMinutes(5));

        try {
            $this->openWa->sendText(
                $number,
                "Your verification code is {$otp}. It expires in 5 minutes."
            );
        } catch (Throwable $error) {
            Cache::forget($otpKey);
            Cache::forget($cooldownKey);

            throw $error;
        }
    }

    public function verify(string $phone, string $otp): bool
    {
        $number = $this->normalizeNumber($phone);
        $otpKey = 'otp-code:'.$number;
        $attemptKey = 'otp-verify:'.$number;

        if (RateLimiter::tooManyAttempts($attemptKey, 5)) {
            throw ValidationException::withMessages([
                'otp' => 'Too many verification attempts. Try again later.',
            ]);
        }

        RateLimiter::hit($attemptKey, 300);

        $storedHash = Cache::get($otpKey);
        $providedHash = hash_hmac(
            'sha256',
            $otp,
            (string) config('app.key')
        );

        if (
            ! is_string($storedHash) ||
            ! hash_equals($storedHash, $providedHash)
        ) {
            return false;
        }

        Cache::forget($otpKey);
        RateLimiter::clear($attemptKey);

        return true;
    }

    private function normalizeNumber(string $phone): string
    {
        $number = preg_replace('/\D+/', '', $phone) ?? '';

        if ($number === '' || str_starts_with($number, '0')) {
            throw ValidationException::withMessages([
                'phone' => 'Use an international phone number with country code.',
            ]);
        }

        return $number;
    }
}
```

This implementation:

- stores an HMAC of the OTP instead of the raw code;
- expires the code after five minutes;
- allows one send request per minute per phone;
- allows five verification attempts per five minutes;
- removes the cached code when OpenWA delivery fails;
- consumes the code after successful verification.

For a public API, also apply Laravel route throttling by IP and authenticated
user. Do not use the phone-only limiter as the sole abuse control.

## OTP Controller And Routes

Create `app/Http/Controllers/Api/WhatsAppOtpController.php`:

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\WhatsAppOtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

final class WhatsAppOtpController extends Controller
{
    public function send(
        Request $request,
        WhatsAppOtpService $otpService
    ): JsonResponse {
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:20'],
        ]);

        $otpService->send($data['phone']);

        return response()->json([
            'message' => 'Verification code sent.',
        ]);
    }

    public function verify(
        Request $request,
        WhatsAppOtpService $otpService
    ): JsonResponse {
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:20'],
            'otp' => ['required', 'digits:6'],
        ]);

        if (! $otpService->verify($data['phone'], $data['otp'])) {
            throw ValidationException::withMessages([
                'otp' => 'The verification code is invalid or expired.',
            ]);
        }

        return response()->json([
            'verified' => true,
        ]);
    }
}
```

Add routes to `routes/api.php`:

```php
use App\Http\Controllers\Api\WhatsAppOtpController;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:10,1')->group(function (): void {
    Route::post('/otp/request', [WhatsAppOtpController::class, 'send']);
    Route::post('/otp/verify', [WhatsAppOtpController::class, 'verify']);
});
```

Adjust route middleware to match the authentication and throttling policy of
the Laravel project.

Test the Laravel endpoint:

```bash
curl -sS -X POST https://your-laravel-domain.com/api/otp/request \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"phone":"201500000000"}'
```

Then verify the received code:

```bash
curl -sS -X POST https://your-laravel-domain.com/api/otp/verify \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"phone":"201500000000","otp":"123456"}'
```

## Direct Laravel Test

Before creating the controller, the client can be tested with Tinker:

```bash
php artisan tinker
```

```php
app(\App\Services\OpenWaClient::class)
    ->sendText('201500000000', 'Hello from Laravel');
```

The expected result is an array containing `messageId` and `timestamp`.

## Queue Recommendation

For production notifications, call `OpenWaClient` from a queued Laravel job.
This keeps web requests responsive and gives the application a controlled place
for logging, retries, and fallback delivery.

For login OTP, choose one of these policies explicitly:

- send synchronously and return an error immediately when WhatsApp is unavailable;
- queue with a very short timeout and notify the user that delivery is pending;
- fall back to SMS or email when the OpenWA session is not `ready`.

Before sending, `OpenWaClient::getSession()` can be used to verify that the
returned `status` equals `ready`.

## Optional Incoming Webhook

Create a webhook after the Laravel callback URL is publicly reachable:

```bash
curl -sS -X POST \
  -H "X-API-Key: $OPENWA_API_KEY" \
  -H "Content-Type: application/json" \
  "$OPENWA_API_URL/sessions/$OPENWA_SESSION_ID/webhooks" \
  -d '{
    "url": "https://your-laravel-domain.com/api/openwa/webhook",
    "events": ["message.received", "session.status"],
    "secret": "replace-with-the-same-long-random-value",
    "retryCount": 3
  }'
```

OpenWA signs the raw JSON body with HMAC SHA-256 and sends the signature in
`X-OpenWA-Signature` using the format `sha256=<hex>`.

Add this route to `routes/api.php`:

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;

Route::post('/openwa/webhook', function (Request $request) {
    $signature = (string) $request->header('X-OpenWA-Signature');
    $expected = 'sha256='.hash_hmac(
        'sha256',
        $request->getContent(),
        (string) config('services.openwa.webhook_secret')
    );

    abort_unless(hash_equals($expected, $signature), 401);

    $idempotencyKey = (string) $request->header(
        'X-OpenWA-Idempotency-Key'
    );

    if (
        $idempotencyKey !== '' &&
        ! Cache::add(
            'openwa-webhook:'.$idempotencyKey,
            true,
            now()->addDay()
        )
    ) {
        return response()->json(['ok' => true, 'duplicate' => true]);
    }

    Log::info('OpenWA webhook', [
        'event' => $request->input('event'),
        'session_id' => $request->input('sessionId'),
        'data' => $request->input('data', []),
    ]);

    return response()->json(['ok' => true]);
});
```

Useful webhook headers include:

| Header | Purpose |
| --- | --- |
| `X-OpenWA-Signature` | HMAC verification |
| `X-OpenWA-Event` | Event name |
| `X-OpenWA-Idempotency-Key` | Duplicate-event protection |
| `X-OpenWA-Delivery-Id` | Delivery attempt identity |
| `X-OpenWA-Retry-Count` | Retry number, starting at `0` |

## Common Errors

| Result | Likely cause | Fix |
| --- | --- | --- |
| HTML beginning with `<!doctype` | Wrong URL reached the dashboard SPA | Use `https://hafez.azq1.com/openwa/api` as the API root |
| `404 Cannot GET` | Duplicate/missing API prefix or wrong endpoint | Use a relative path such as `sessions/...`, without another `/api` |
| `401 Unauthorized` | Missing, invalid, revoked, or restricted API key | Check `X-API-Key`, role, IP restriction, session restriction, and expiry |
| `400 Session not active` | WhatsApp session is not ready | Open the dashboard and restore the session to `ready` |
| `404 Session not found` | Wrong `OPENWA_SESSION_ID` | Run `GET $OPENWA_API_URL/sessions` and copy the correct ID |
| `429 Too Many Requests` | OpenWA or Laravel rate limit reached | Wait for reset and reduce request frequency |
| Laravel receives connection timeout | OpenWA, DNS, SSL, or firewall issue | Run the smoke-test `curl` commands from the Laravel server |
| Message sends but UI says disconnected | WebSocket UI state is stale | Trust the REST session response for the integration and fix the dashboard socket separately |

## Production Checklist

- The API root is exactly `https://hafez.azq1.com/openwa/api`.
- The API key has the `operator` role, not `admin`.
- The key is restricted to the Laravel server IP and target session.
- The key exists only in Laravel's server-side environment.
- The session ID points to a session with status `ready`.
- Numbers are converted to international format before sending.
- OTP values are hashed, expire quickly, and are rate-limited.
- Failed WhatsApp delivery has an SMS or email fallback where required.
- Webhook signatures are checked against the raw request body.
- Logs never include API keys or raw OTP values.

## Agent Handoff Contract

Use the following contract when assigning this integration to another coding
agent.

### Objective

Integrate a Laravel application with the deployed OpenWA server so Laravel can
send and verify login OTP codes over WhatsApp.

### Fixed OpenWA Values

```text
Dashboard: https://hafez.azq1.com
API root: https://hafez.azq1.com/openwa/api
Health: https://hafez.azq1.com/openwa/api/health
Swagger: https://hafez.azq1.com/openwa/api/docs
Auth header: X-API-Key
Send endpoint: POST sessions/{sessionId}/messages/send-text
Check endpoint: GET sessions/{sessionId}/contacts/check/{number}
Send payload: {"chatId":"201XXXXXXXXX@c.us","text":"..."}
Required session status: ready
Required API key role: operator
```

### Laravel Files

Create or update:

```text
.env
config/services.php
app/Services/OpenWaClient.php
app/Services/WhatsAppOtpService.php
app/Http/Controllers/Api/WhatsAppOtpController.php
routes/api.php
```

### Constraints

- Keep the OpenWA API key server-side.
- Do not use an admin key for message delivery.
- Do not add another `/api` after `OPENWA_API_URL`.
- Use relative request paths without a leading slash.
- Generate and verify OTP codes in Laravel, not OpenWA.
- Store only an HMAC/hash of the OTP.
- Rate-limit requests by phone, IP, and user where available.
- Do not blindly retry `send-text` POST requests.
- Never log the API key or raw OTP.
- Preserve the Laravel project's existing service, validation, queue, and error-response conventions.

### Acceptance Criteria

1. `GET https://hafez.azq1.com/openwa/api/health` returns JSON with `status: ok`.
2. Authenticated `GET .../sessions` returns JSON and identifies a `ready` session.
3. A Tinker call through `OpenWaClient::sendText()` delivers a test message.
4. `POST /api/otp/request` sends a six-digit OTP without returning it in the response.
5. `POST /api/otp/verify` accepts the correct unexpired OTP once.
6. Invalid, expired, reused, and over-attempted OTP codes are rejected.
7. API keys and raw OTP values are absent from source control and logs.
8. Automated tests mock Laravel's HTTP client; they must not send real WhatsApp messages.
