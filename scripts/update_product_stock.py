import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

from defusedxml import ElementTree


ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_PATH = ROOT / "products.json"

XML_URL = os.environ.get("XML_URL", "").strip()
ZERO_STOCK_FOR_MISSING = (
    os.environ.get("ZERO_STOCK_FOR_MISSING_PRODUCTS", "false").strip().lower()
    in {"1", "true", "yes", "on"}
)


def local_name(tag):
    """Убирает XML namespace из имени элемента."""
    return tag.rsplit("}", 1)[-1].lower()


def direct_child_text(element, *names):
    """Возвращает текст первого прямого дочернего элемента с указанным именем."""
    wanted = {name.lower() for name in names}

    for child in list(element):
        if local_name(child.tag) in wanted:
            return (child.text or "").strip()

    return ""


def get_group_id(item):
    """Поддерживает group_id как атрибут или как дочерний элемент."""
    return (
        item.attrib.get("group_id", "").strip()
        or item.attrib.get("groupId", "").strip()
        or direct_child_text(item, "group_id", "groupId")
    )


def parse_nonnegative_int(value):
    try:
        # XML обычно содержит целые количества; float-строки тоже обработаем.
        number = int(float(str(value).strip().replace(",", ".")))
        return max(0, number)
    except (TypeError, ValueError):
        return 0


def parse_price(value):
    try:
        return float(str(value).strip().replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def get_item_size(item):
    """Ищет размер в <param name="Розмір">, как импортёр сайта."""
    for param in list(item):
        if local_name(param.tag) != "param":
            continue

        param_name = (param.attrib.get("name", "") or "").strip().lower()
        if (
            param_name in {"розмір", "размер", "size"}
            or "розмір" in param_name
            or "размер" in param_name
        ):
            return (param.text or "").strip()

    return ""


def get_item_quantity(item):
    raw = (
        direct_child_text(item, "quantity_in_stock")
        or direct_child_text(item, "quantity")
    )
    return parse_nonnegative_int(raw)


def get_item_price(item):
    raw = direct_child_text(item, "priceuah") or direct_child_text(item, "price")
    return parse_price(raw)


def get_item_sku(item):
    return (
        direct_child_text(item, "barcode")
        or direct_child_text(item, "vendorCode")
        or ""
    )


def fetch_xml(url):
    if not url:
        raise RuntimeError(
            "Не задан XML_URL. Добавьте URL XML в GitHub repository secret XML_URL."
        )

    if not url.lower().startswith("https://"):
        raise RuntimeError(
            "XML_URL должен начинаться с https://. "
            "Проверьте ссылку поставщика и не передавайте секреты через HTTP."
        )

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "KICKS-UA-GitHub-Actions-Stock-Sync/1.0",
            "Accept": "application/xml,text/xml,*/*",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            content_type = response.headers.get("Content-Type", "")
            content = response.read(100 * 1024 * 1024 + 1)

            if len(content) > 100 * 1024 * 1024:
                raise RuntimeError("XML-файл больше допустимого лимита 100 МБ.")

            if not content:
                raise RuntimeError("Сервер поставщика вернул пустой XML-файл.")

            print(f"XML downloaded; Content-Type: {content_type or 'unknown'}")
            return content

    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Поставщик вернул HTTP {error.code}.") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Не удалось загрузить XML: {error.reason}") from error


def find_items_container(root):
    for element in root.iter():
        if local_name(element.tag) == "items":
            return element
    return None


def parse_xml_groups(xml_bytes):
    try:
        root = ElementTree.fromstring(xml_bytes)
    except Exception as error:
        raise RuntimeError(f"Не удалось разобрать XML: {error}") from error

    items_container = find_items_container(root)
    if items_container is None:
        raise RuntimeError(
            "В XML не найден контейнер <items>. "
            "Ожидается формат, который использует import.html."
        )

    grouped = defaultdict(list)

    for item in list(items_container):
        if local_name(item.tag) != "item":
            continue

        group_id = get_group_id(item)
        if not group_id:
            continue

        size = get_item_size(item)
        if not size:
            # Без размера нельзя сопоставить остаток с вариацией.
            continue

        grouped[group_id].append(
            {
                "size": size,
                "stock": get_item_quantity(item),
                "price": get_item_price(item),
                "sku": get_item_sku(item),
            }
        )

    if not grouped:
        raise RuntimeError(
            "В XML не найдено ни одной группы с group_id и размером. "
            "Проверьте структуру XML и названия параметров размера."
        )

    return grouped


def read_products():
    if not PRODUCTS_PATH.exists():
        raise RuntimeError(f"Не найден файл {PRODUCTS_PATH}")

    try:
        with PRODUCTS_PATH.open("r", encoding="utf-8") as file:
            products = json.load(file)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"products.json содержит ошибку JSON: {error}") from error

    if not isinstance(products, list):
        raise RuntimeError("В корне products.json должен находиться массив товаров.")

    return products


def update_product_stock(product, xml_variants):
    """
    Обновляет только остатки и список доступных размеров.
    Сохраняет id, описание, изображения, ручные настройки и существующие цены.
    Цены существующих вариантов намеренно не перезаписываются.
    """
    old_variants = product.get("variants")
    if not isinstance(old_variants, list):
        old_variants = []

    # Нормализуем существующие варианты по размеру.
    existing_by_size = {}
    for variant in old_variants:
        if not isinstance(variant, dict):
            continue

        size = str(variant.get("size", "")).strip()
        if size:
            existing_by_size[size] = dict(variant)

    # В XML может встретиться один размер несколько раз.
    # Выбираем запись с наибольшим остатком, как ручной импортёр.
    incoming_by_size = {}
    for variant in xml_variants:
        size = variant["size"]
        current = incoming_by_size.get(size)

        if current is None or variant["stock"] > current["stock"]:
            incoming_by_size[size] = variant

    # Оставляем старые варианты в JSON, даже если поставщик временно не передал
    # какой-то размер: его остаток будет явно выставлен в 0.
    all_sizes = set(existing_by_size) | set(incoming_by_size)
    updated_variants = []

    for size in sorted(all_sizes, key=lambda value: (not value.replace(".", "", 1).isdigit(), value)):
        old_variant = existing_by_size.get(size, {})
        incoming = incoming_by_size.get(size)

        if incoming is None:
            updated = dict(old_variant)
            updated["size"] = size
            updated["stock"] = 0
        else:
            updated = dict(old_variant)
            updated["size"] = size
            updated["stock"] = incoming["stock"]

            # Для нового размера нужны цена и SKU. У существующего SKU
            # сохраняем старый, если XML не прислал значение.
            if size not in existing_by_size and incoming["price"] > 0:
                updated["price"] = incoming["price"]

            if incoming["sku"]:
                updated["sku"] = incoming["sku"]
            elif "sku" not in updated:
                updated["sku"] = ""

        updated_variants.append(updated)

    product["variants"] = updated_variants
    product["sizes"] = [
        variant["size"]
        for variant in updated_variants
        if parse_nonnegative_int(variant.get("stock", 0)) > 0
    ]
    product["stock"] = sum(
        parse_nonnegative_int(variant.get("stock", 0))
        for variant in updated_variants
    )

    return product


def write_json_atomically(products):
    content = json.dumps(products, ensure_ascii=False, indent=2) + "\n"

    # Атомарная замена защищает файл от частичной записи при остановке процесса.
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=ROOT,
        prefix="products.",
        suffix=".tmp",
        delete=False,
    ) as temporary_file:
        temporary_file.write(content)
        temporary_path = Path(temporary_file.name)

    temporary_path.replace(PRODUCTS_PATH)


def main():
    xml_bytes = fetch_xml(XML_URL)
    grouped = parse_xml_groups(xml_bytes)
    products = read_products()

    by_group_id = {}
    for index, product in enumerate(products):
        if not isinstance(product, dict):
            continue

        if product.get("source") != "crm-xml":
            continue

        group_id = str(product.get("sourceGroupId", "")).strip()
        if group_id:
            by_group_id[group_id] = index

    if not by_group_id:
        raise RuntimeError(
            "В products.json не найдены CRM-товары с source='crm-xml' "
            "и sourceGroupId. Изменения не записаны."
        )

    updated_count = 0
    matched_group_ids = set()

    for group_id, xml_variants in grouped.items():
        product_index = by_group_id.get(group_id)
        if product_index is None:
            # Автоматическая задача не создаёт новые товары.
            continue

        products[product_index] = update_product_stock(
            products[product_index],
            xml_variants,
        )
        matched_group_ids.add(group_id)
        updated_count += 1

    missing_count = 0

    if ZERO_STOCK_FOR_MISSING:
        print(
            "WARNING: ZERO_STOCK_FOR_MISSING_PRODUCTS is enabled. "
            "CRM products absent from XML will be set to stock 0."
        )

        for group_id, product_index in by_group_id.items():
            if group_id in matched_group_ids:
                continue

            product = products[product_index]
            variants = product.get("variants", [])

            if isinstance(variants, list):
                for variant in variants:
                    if isinstance(variant, dict):
                        variant["stock"] = 0

            product["sizes"] = []
            product["stock"] = 0
            missing_count += 1

    if updated_count == 0:
        raise RuntimeError(
            "XML загружен, но ни один group_id не совпал с sourceGroupId в products.json. "
            "Возможны неверный XML_URL или другая структура XML. "
            "products.json не изменён."
        )

    write_json_atomically(products)

    print(f"XML groups: {len(grouped)}")
    print(f"Existing products updated: {updated_count}")
    print(f"Products absent from XML set to stock 0: {missing_count}")
    print(f"Updated file: {PRODUCTS_PATH}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
