# 23 - Laravel Integration

This guide shows how to use OpenWA from a Laravel application to send WhatsApp notifications and OTP messages.

> OpenWA uses WhatsApp Web via `whatsapp-web.js`, not the official Meta WhatsApp Business API. For critical OTP flows, keep SMS/email as a fallback and rate-limit attempts per phone number.

## Prerequisites

1. Start OpenWA and open the dashboard.
2. Create or start a WhatsApp session and scan the QR code.
3. Create an API key with the `operator` role. For production, restrict it to your Laravel server IP and the session ID it should use.
4. Keep the OpenWA API private behind HTTPS or a private network when possible.

## Laravel Environment

Add these values to your Laravel `.env`:

```env
OPENWA_URL=https://wa.example.com
OPENWA_API_KEY=owa_k1_your_key_here
OPENWA_SESSION_ID=your-session-uuid
OPENWA_WEBHOOK_SECRET=change-me
```

Add them to `config/services.php`:

```php
'openwa' => [
    'url' => env('OPENWA_URL', 'http://localhost:2785'),
    'key' => env('OPENWA_API_KEY'),
    'session_id' => env('OPENWA_SESSION_ID'),
    'webhook_secret' => env('OPENWA_WEBHOOK_SECRET'),
],
```

## HTTP Client

Create a small service class, for example `app/Services/OpenWaClient.php`:

```php
<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

class OpenWaClient
{
    private function http(): PendingRequest
    {
        return Http::baseUrl(rtrim(config('services.openwa.url'), '/'))
            ->withHeaders([
                'X-API-Key' => config('services.openwa.key'),
                'Accept' => 'application/json',
            ])
            ->timeout(15)
            ->retry(2, 500);
    }

    public function sendText(string $phone, string $message, ?string $sessionId = null): array
    {
        $sessionId ??= config('services.openwa.session_id');

        return $this->http()
            ->post("/api/sessions/{$sessionId}/messages/send-text", [
                'chatId' => $this->chatId($phone),
                'text' => $message,
            ])
            ->throw()
            ->json();
    }

    public function checkNumber(string $phone, ?string $sessionId = null): bool
    {
        $sessionId ??= config('services.openwa.session_id');
        $number = preg_replace('/\D+/', '', $phone);

        return (bool) $this->http()
            ->get("/api/sessions/{$sessionId}/contacts/check/{$number}")
            ->throw()
            ->json('exists');
    }

    private function chatId(string $phone): string
    {
        $number = preg_replace('/\D+/', '', $phone);

        return "{$number}@c.us";
    }
}
```

## Sending OTP

Use OpenWA as the delivery transport, but keep OTP generation and verification inside Laravel.

```php
use App\Services\OpenWaClient;
use Illuminate\Support\Facades\Cache;

class SendWhatsappOtp
{
    public function __construct(private OpenWaClient $openWa) {}

    public function handle(string $phone): void
    {
        $key = 'otp:'.preg_replace('/\D+/', '', $phone);

        throw_if(Cache::has($key.':lock'), \RuntimeException::class, 'Please wait before requesting another OTP.');

        $otp = (string) random_int(100000, 999999);

        Cache::put($key, hash('sha256', $otp), now()->addMinutes(5));
        Cache::put($key.':lock', true, now()->addSeconds(60));

        $this->openWa->sendText($phone, "Your verification code is {$otp}. It expires in 5 minutes.");
    }
}
```

Recommended OTP rules:

- Use a short expiry, usually 5 minutes.
- Rate-limit per phone, user, and IP.
- Store a hash of the OTP, not the raw code.
- Add a fallback channel for failed WhatsApp delivery.
- Do not send OTP through bulk messaging.

## Laravel Notification Channel

For normal notifications, create a lightweight custom channel:

```php
<?php

namespace App\Notifications\Channels;

use App\Services\OpenWaClient;

class WhatsAppChannel
{
    public function __construct(private OpenWaClient $openWa) {}

    public function send(object $notifiable, object $notification): void
    {
        $message = $notification->toWhatsApp($notifiable);
        $phone = $notifiable->routeNotificationFor('whatsapp') ?? $notifiable->phone;

        $this->openWa->sendText($phone, $message);
    }
}
```

Example notification:

```php
use App\Notifications\Channels\WhatsAppChannel;
use Illuminate\Notifications\Notification;

class OrderPaidNotification extends Notification
{
    public function via(object $notifiable): array
    {
        return [WhatsAppChannel::class];
    }

    public function toWhatsApp(object $notifiable): string
    {
        return "Your order has been paid successfully.";
    }
}
```

## Receiving Webhooks In Laravel

Create a webhook in OpenWA:

```bash
curl -X POST "$OPENWA_URL/api/sessions/$OPENWA_SESSION_ID/webhooks" \
  -H "X-API-Key: $OPENWA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-laravel-app.com/openwa/webhook",
    "events": ["message.received", "session.status"],
    "secret": "change-me"
  }'
```

Verify the HMAC signature in Laravel:

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::post('/openwa/webhook', function (Request $request) {
    $signature = $request->header('X-OpenWA-Signature');
    $expected = 'sha256='.hash_hmac(
        'sha256',
        $request->getContent(),
        config('services.openwa.webhook_secret')
    );

    abort_unless(hash_equals($expected, (string) $signature), 401);

    $event = $request->input('event');
    $data = $request->input('data', []);

    // Store message, trigger jobs, or update session state here.

    return response()->json(['ok' => true]);
});
```

## Production Notes

- Use an `operator` API key for Laravel message sending, not an `admin` key.
- Add `allowedIps` and `allowedSessions` to the API key from the dashboard.
- Run Laravel sends through a queue job so user requests do not wait for WhatsApp.
- Monitor session status. If the session is not `ready`, send through your fallback channel.
- Keep `/api/infra/*`, `/api/plugins/*`, and admin keys away from public clients.
