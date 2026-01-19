# Публикация Push360 SDK на pub.dev

## Шаг 1: Подготовка

1. Создайте аккаунт на https://pub.dev
2. Войдите через Google аккаунт
3. Установите `dart` SDK если ещё нет

## Шаг 2: Подготовка пакета

Структура должна быть:
```
push360_sdk/
├── lib/
│   └── push360_sdk.dart
├── pubspec.yaml
├── README.md
├── CHANGELOG.md
├── LICENSE
└── example/
    └── example.dart
```

## Шаг 3: Проверка пакета

```bash
cd push360_sdk
dart pub publish --dry-run
```

## Шаг 4: Публикация

```bash
dart pub publish
```

После публикации пользователи смогут установить:
```yaml
dependencies:
  push360_sdk: ^1.0.0
```

## Для FlutterFlow

После публикации на pub.dev:
1. В FlutterFlow откройте Settings → Custom Code
2. Add Dependency → push360_sdk
3. Используйте в Custom Functions
